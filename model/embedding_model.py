import torch
from torch import nn
import torch.nn.functional as F

from .embedding_config import EmbeddingConfig


class AstraCoreEmbed(nn.Module):
    """Small trainable sentence/document encoder owned by AstraCore.

    It is intentionally not presented as a trained semantic model until real
    contrastive training has produced a checkpoint. Forward() returns a
    normalized 384-dimensional vector suitable for pgvector cosine distance.
    """

    def __init__(self, config: EmbeddingConfig):
        super().__init__()
        self.config = config
        self.token_embedding = nn.Embedding(config.vocab_size, config.hidden_dim, padding_idx=0)
        self.position_embedding = nn.Embedding(config.max_length, config.hidden_dim)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=config.hidden_dim,
            nhead=8,
            dim_feedforward=config.hidden_dim * 4,
            dropout=config.dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=4)
        self.projection = nn.Linear(config.hidden_dim, config.embedding_dim)
        self.norm = nn.LayerNorm(config.embedding_dim)

    def forward(self, input_ids, attention_mask=None):
        batch, seq = input_ids.shape
        positions = torch.arange(seq, device=input_ids.device).unsqueeze(0).expand(batch, seq)
        x = self.token_embedding(input_ids) + self.position_embedding(positions)
        key_padding_mask = None if attention_mask is None else ~attention_mask.bool()
        x = self.encoder(x, src_key_padding_mask=key_padding_mask)
        if attention_mask is None:
            pooled = x.mean(dim=1)
        else:
            weights = attention_mask.unsqueeze(-1).float()
            pooled = (x * weights).sum(dim=1) / weights.sum(dim=1).clamp_min(1.0)
        return F.normalize(self.norm(self.projection(pooled)), dim=-1)

    @staticmethod
    def contrastive_loss(a, b, temperature=0.07):
        logits = (a @ b.T) / temperature
        labels = torch.arange(a.size(0), device=a.device)
        return (F.cross_entropy(logits, labels) + F.cross_entropy(logits.T, labels)) / 2

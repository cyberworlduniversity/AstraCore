import torch
from torch import nn
import torch.nn.functional as F
from .config import ModelConfig

class AstraCoreLM(nn.Module):
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.config = config
        self.context_length = config.context_length
        self.token = nn.Embedding(config.vocab_size, config.embedding_dimension)
        self.position = nn.Embedding(config.context_length, config.embedding_dimension)
        layer = nn.TransformerEncoderLayer(d_model=config.embedding_dimension, nhead=config.attention_heads, dim_feedforward=config.feed_forward_dimension, dropout=config.dropout, activation='gelu', batch_first=True, norm_first=True)
        self.transformer = nn.TransformerEncoder(layer, num_layers=config.number_of_layers)
        self.norm = nn.LayerNorm(config.embedding_dimension)
        self.lm_head = nn.Linear(config.embedding_dimension, config.vocab_size, bias=False)
        self.lm_head.weight = self.token.weight

    def forward(self, input_ids, targets=None):
        _, length = input_ids.shape
        positions = torch.arange(length, device=input_ids.device).unsqueeze(0)
        x = self.token(input_ids) + self.position(positions)
        causal = torch.triu(torch.ones(length, length, device=input_ids.device, dtype=torch.bool), diagonal=1)
        x = self.transformer(x, mask=causal)
        logits = self.lm_head(self.norm(x))
        loss = None
        if targets is not None: loss = F.cross_entropy(logits.reshape(-1, logits.size(-1)), targets.reshape(-1), ignore_index=-100)
        return logits, loss

    def next_token(self, input_ids):
        self.eval()
        with torch.no_grad():
            logits, _ = self(input_ids[:, -self.context_length:])
            return int(torch.argmax(logits[:, -1, :], dim=-1).item())

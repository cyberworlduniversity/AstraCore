import torch
from torch import nn
import torch.nn.functional as F
from .config_v02 import ModelConfigV02

class AstraCoreLMV02(nn.Module):
    def __init__(self, config: ModelConfigV02):
        super().__init__()
        self.config = config
        self.context_length = config.context_length
        self.pad_id = 0
        self.token = nn.Embedding(config.vocab_size, config.embedding_dimension)
        self.position = nn.Embedding(config.context_length, config.embedding_dimension)
        layer = nn.TransformerEncoderLayer(
            d_model=config.embedding_dimension,
            nhead=config.attention_heads,
            dim_feedforward=config.feed_forward_dimension,
            dropout=config.dropout,
            activation='gelu',
            batch_first=True,
            norm_first=True,
        )
        self.transformer = nn.TransformerEncoder(layer, num_layers=config.number_of_layers)
        self.norm = nn.LayerNorm(config.embedding_dimension)
        self.lm_head = nn.Linear(config.embedding_dimension, config.vocab_size, bias=False)
        if config.weight_tying:
            self.lm_head.weight = self.token.weight

    def _masks(self, input_ids):
        _, length = input_ids.shape
        if length > self.context_length:
            raise ValueError(f'CONTEXT_LENGTH_EXCEEDED:{length}>{self.context_length}')
        positions = torch.arange(length, device=input_ids.device).unsqueeze(0)
        causal = torch.triu(torch.ones(length, length, device=input_ids.device, dtype=torch.bool), diagonal=1)
        padding = input_ids.eq(self.pad_id)
        return positions, causal, padding

    def forward(self, input_ids, targets=None):
        positions, causal, padding = self._masks(input_ids)
        x = self.token(input_ids) + self.position(positions)
        x = self.transformer(x, mask=causal, src_key_padding_mask=padding)
        logits = self.lm_head(self.norm(x))
        loss = None
        if targets is not None:
            loss = F.cross_entropy(
                logits.reshape(-1, logits.size(-1)),
                targets.reshape(-1),
                ignore_index=self.pad_id,
            )
        return logits, loss

    @torch.no_grad()
    def generate_greedy(self, input_ids, eos_id, max_new_tokens=32):
        self.eval()
        if input_ids.ndim != 2 or input_ids.shape[0] != 1:
            raise ValueError('generation expects shape [1, sequence]')
        if input_ids.shape[1] > self.context_length:
            raise ValueError('CONTEXT_LENGTH_EXCEEDED')
        generated = input_ids.clone()
        for _ in range(max_new_tokens):
            window = generated[:, -self.context_length:]
            logits, _ = self(window)
            nxt = torch.argmax(logits[:, -1, :], dim=-1, keepdim=True)
            generated = torch.cat([generated, nxt], dim=1)
            if int(nxt.item()) == int(eos_id):
                break
        return generated

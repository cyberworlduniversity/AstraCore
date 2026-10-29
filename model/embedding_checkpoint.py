import json
import os

import torch

from .embedding_config import EmbeddingConfig
from .embedding_model import AstraCoreEmbed
from .embedding_tokenizer import EmbedTokenizer


class EmbeddingCheckpoint:
    """Loads a trained AstraCoreEmbed checkpoint without any external model provider."""

    def __init__(self, model, tokenizer, config, path):
        self.model = model
        self.tokenizer = tokenizer
        self.config = config
        self.path = path

    @classmethod
    def load(cls, directory, device="cpu"):
        model_path = os.path.join(directory, "model.pt")
        config_path = os.path.join(directory, "config.json")
        tokenizer_path = os.path.join(directory, "tokenizer.json")
        state_path = os.path.join(directory, "training_state.json")
        for path in (model_path, config_path, tokenizer_path, state_path):
            if not os.path.isfile(path):
                raise FileNotFoundError(f"Incomplete embedding checkpoint: {path}")

        with open(config_path, "r", encoding="utf-8") as handle:
            config = EmbeddingConfig.from_dict(json.load(handle))
        with open(tokenizer_path, "r", encoding="utf-8") as handle:
            tokenizer = EmbedTokenizer.from_dict(json.load(handle))
        with open(state_path, "r", encoding="utf-8") as handle:
            state = json.load(handle)
        if state.get("status") != "trained":
            raise ValueError("Embedding checkpoint is not marked as trained")

        model = AstraCoreEmbed(config)
        model.load_state_dict(torch.load(model_path, map_location=device, weights_only=True))
        model.to(device)
        model.eval()
        return cls(model, tokenizer, config, directory)

    def encode(self, texts, device="cpu"):
        if not texts:
            return torch.empty((0, self.config.embedding_dim))
        ids = [self.tokenizer.encode(text, max_length=self.config.max_length) for text in texts]
        width = max(1, min(self.config.max_length, max(len(row) for row in ids)))
        input_ids = torch.zeros((len(ids), width), dtype=torch.long, device=device)
        mask = torch.zeros((len(ids), width), dtype=torch.bool, device=device)
        for index, row in enumerate(ids):
            row = row[:width]
            if row:
                input_ids[index, :len(row)] = torch.tensor(row, dtype=torch.long, device=device)
                mask[index, :len(row)] = True
        with torch.no_grad():
            return self.model(input_ids, mask)

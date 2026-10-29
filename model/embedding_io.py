import json
from pathlib import Path

import torch

from .embedding_config import EmbeddingConfig
from .embedding_model import AstraCoreEmbed
from .embedding_tokenizer import EmbedTokenizer


def save_checkpoint(path, model, tokenizer, config, metadata=None):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "model": model.state_dict(),
        "config": config.to_dict(),
        "tokenizer": tokenizer.to_dict(),
        "metadata": metadata or {},
    }, target)


def load_checkpoint(path, device="cpu"):
    payload = torch.load(path, map_location=device, weights_only=False)
    config = EmbeddingConfig(**payload["config"])
    model = AstraCoreEmbed(config).to(device)
    model.load_state_dict(payload["model"])
    model.eval()
    tokenizer = EmbedTokenizer.from_dict(payload["tokenizer"])
    return model, tokenizer, config, payload.get("metadata", {})


def save_metadata(path, config, status, **extra):
    Path(path).write_text(json.dumps({"config": config.to_dict(), "status": status, **extra}, indent=2), encoding="utf-8")

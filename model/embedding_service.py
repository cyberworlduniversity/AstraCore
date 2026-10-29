import torch

from .embedding_io import load_checkpoint


class EmbeddingService:
    """Local-only embedding service. Refuses to emit semantic vectors without a trained checkpoint."""

    def __init__(self, checkpoint_path=None, device="cpu"):
        self.device = device
        self.model = None
        self.tokenizer = None
        self.config = None
        self.metadata = {}
        if checkpoint_path:
            self.model, self.tokenizer, self.config, self.metadata = load_checkpoint(checkpoint_path, device)

    @property
    def ready(self):
        return self.model is not None and self.metadata.get("status") == "trained"

    def embed(self, text):
        if not self.ready:
            raise RuntimeError("AstraCoreEmbed has no verified trained checkpoint; semantic embedding is not enabled.")
        ids = self.tokenizer.encode(text, self.config.max_length)
        input_ids = torch.tensor([ids or [0]], dtype=torch.long, device=self.device)
        mask = input_ids.ne(0)
        with torch.no_grad():
            vector = self.model(input_ids, mask)[0].cpu().tolist()
        if len(vector) != 384:
            raise RuntimeError(f"Embedding contract violation: expected 384 dimensions, got {len(vector)}")
        return vector

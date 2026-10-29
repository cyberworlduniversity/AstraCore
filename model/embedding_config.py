from dataclasses import dataclass


@dataclass(frozen=True)
class EmbeddingConfig:
    """AstraCoreEmbed v0.1 configuration.

    The production vector contract is fixed at 384 dimensions to match
    public.astracore_knowledge_chunks.embedding. No external embedding API is used.
    """

    vocab_size: int = 8192
    embedding_dim: int = 384
    hidden_dim: int = 256
    max_length: int = 256
    dropout: float = 0.1

    def to_dict(self):
        return self.__dict__.copy()

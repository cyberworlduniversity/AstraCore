from dataclasses import dataclass

@dataclass
class ModelConfig:
    vocab_size: int
    context_length: int = 256
    embedding_dimension: int = 128
    number_of_layers: int = 4
    attention_heads: int = 4
    feed_forward_dimension: int = 512
    dropout: float = 0.1

    def to_dict(self):
        return self.__dict__.copy()

    @classmethod
    def from_dict(cls, payload):
        return cls(**payload)

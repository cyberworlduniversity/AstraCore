from dataclasses import dataclass

@dataclass
class ModelConfigV02:
    vocab_size: int
    context_length: int = 128
    embedding_dimension: int = 256
    number_of_layers: int = 4
    attention_heads: int = 8
    feed_forward_dimension: int = 1024
    dropout: float = 0.1
    architecture_version: str = 'astracorelm-arch-v0.2'
    normalization: str = 'LayerNorm-pre-norm'
    positional_encoding: str = 'learned-absolute'
    weight_tying: bool = True
    tokenizer_version: str = 'astratokenizer-v0.1'
    tokenizer_sha256: str = ''
    max_encoded_sequence_length: int = 128

    def to_dict(self):
        return self.__dict__.copy()

    @classmethod
    def from_dict(cls, payload):
        return cls(**payload)

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
    special_token_overhead: int = 2
    max_encoded_sequence_length: int = 128
    max_raw_input_tokens: int = 126

    def __post_init__(self):
        # Keep the context contract internally consistent when tests or tools
        # construct a non-default context length. Explicit non-default limits
        # remain respected.
        if self.max_encoded_sequence_length == 128 and self.context_length != 128:
            self.max_encoded_sequence_length = self.context_length
        if self.max_raw_input_tokens == 126 and self.context_length != 128:
            self.max_raw_input_tokens = self.context_length - self.special_token_overhead
        if self.max_raw_input_tokens < 0 or self.max_encoded_sequence_length < self.special_token_overhead:
            raise ValueError('INVALID_CONTEXT_CONTRACT')
        if self.max_raw_input_tokens + self.special_token_overhead > self.max_encoded_sequence_length:
            raise ValueError('INVALID_CONTEXT_CONTRACT')

    def to_dict(self): return self.__dict__.copy()

    @classmethod
    def from_dict(cls, payload): return cls(**payload)

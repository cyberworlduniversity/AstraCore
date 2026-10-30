import json
import unicodedata

SPECIAL = {'<pad>': 0, '<unk>': 1, '<bos>': 2, '<eos>': 3}


def _tokenize(text):
    """Deterministic Unicode-aware tokenization with combining-mark preservation."""
    tokens = []
    current = []

    def flush():
        if current:
            tokens.append(''.join(current))
            current.clear()

    for char in str(text).lower():
        category = unicodedata.category(char)
        if char.isspace():
            flush()
        elif char.isalnum() or char == '_' or category.startswith('M'):
            current.append(char)
        else:
            flush()
            tokens.append(char)
    flush()
    return tokens


class AstraTokenizer:
    def __init__(self, vocab):
        self.vocab = dict(vocab)
        self.inverse = {v: k for k, v in self.vocab.items()}
        self.pad_id, self.unk_id, self.bos_id, self.eos_id = [self.vocab[x] for x in ('<pad>','<unk>','<bos>','<eos>')]

    @classmethod
    def build(cls, texts, vocab_size=8192):
        counts = {}
        for text in texts:
            for token in _tokenize(text):
                counts[token] = counts.get(token, 0) + 1
        vocab = dict(SPECIAL)
        for token, _ in sorted(counts.items(), key=lambda x: (-x[1], x[0])):
            if token not in vocab:
                if len(vocab) >= vocab_size: break
                vocab[token] = len(vocab)
        return cls(vocab)

    @property
    def vocab_size(self): return len(self.vocab)
    def tokens(self, text): return _tokenize(text)

    def encode(self, text, add_bos=True, add_eos=True):
        ids = [self.vocab.get(t, self.unk_id) for t in _tokenize(text)]
        return ([self.bos_id] if add_bos else []) + ids + ([self.eos_id] if add_eos else [])

    def encode_for_context(self, text, max_raw_tokens, max_encoded_tokens):
        raw_tokens = _tokenize(text)
        if len(raw_tokens) > max_raw_tokens:
            raise ValueError(f'RAW_INPUT_TOKENS_EXCEEDED:{len(raw_tokens)}>{max_raw_tokens}')
        ids = [self.vocab.get(t, self.unk_id) for t in raw_tokens]
        encoded = [self.bos_id] + ids + [self.eos_id]
        if len(encoded) > max_encoded_tokens:
            raise ValueError(f'CONTEXT_LENGTH_EXCEEDED:{len(encoded)}>{max_encoded_tokens}')
        return encoded

    def decode(self, ids): return ' '.join(self.inverse.get(int(i), '<unk>') for i in ids if int(i) not in (self.pad_id,self.bos_id,self.eos_id))
    def to_dict(self): return {'vocab': self.vocab}
    @classmethod
    def from_dict(cls, payload): return cls(payload['vocab'])
    def save(self, path): json.dump(self.to_dict(), open(path,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
    @classmethod
    def load(cls, path): return cls.from_dict(json.load(open(path,encoding='utf-8')))

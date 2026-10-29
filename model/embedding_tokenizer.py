import re


SPECIAL = {"<pad>": 0, "<unk>": 1}


def tokenize(text: str):
    # Word + punctuation tokenization keeps programming/cybersecurity symbols visible.
    return re.findall(r"[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[^\w\s]", str(text or "").lower())


class EmbedTokenizer:
    def __init__(self, vocab=None):
        self.vocab = dict(vocab or SPECIAL)
        self.vocab.setdefault("<pad>", 0)
        self.vocab.setdefault("<unk>", 1)
        self.inverse = {v: k for k, v in self.vocab.items()}

    def fit(self, texts, max_vocab=8192):
        counts = {}
        for text in texts:
            for token in tokenize(text):
                counts[token] = counts.get(token, 0) + 1
        for token, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
            if token in self.vocab:
                continue
            if len(self.vocab) >= max_vocab:
                break
            self.vocab[token] = len(self.vocab)
        self.inverse = {v: k for k, v in self.vocab.items()}
        return self

    def encode(self, text, max_length=256):
        ids = [self.vocab.get(t, self.vocab["<unk>"]) for t in tokenize(text)]
        return ids[:max_length]

    def to_dict(self):
        return {"vocab": self.vocab}

    @classmethod
    def from_dict(cls, payload):
        return cls(payload.get("vocab", SPECIAL))

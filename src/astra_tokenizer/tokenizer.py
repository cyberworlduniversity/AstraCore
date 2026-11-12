"""Dependency-free byte-level BPE tokenizer.

The base vocabulary contains all 256 byte values. Learned tokens are byte
sequences, so arbitrary UTF-8 text (including Tamil) can be encoded and
decoded without lossy Unicode splitting.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Iterable


class ByteBPETokenizer:
    FORMAT_VERSION = 1

    def __init__(self, merges: list[tuple[int, int]] | None = None):
        self.merges: list[tuple[int, int]] = list(merges or [])
        self._merge_ranks = {pair: rank for rank, pair in enumerate(self.merges)}
        self.vocab_size = 256 + len(self.merges)

    @staticmethod
    def _words_from_texts(texts: Iterable[str]) -> Counter[tuple[int, ...]]:
        counts: Counter[tuple[int, ...]] = Counter()
        for text in texts:
            if not isinstance(text, str):
                raise TypeError("Training input must contain strings")
            # Learn merges across common whitespace-delimited chunks. Each
            # chunk remains reversible because its underlying symbols are bytes.
            for chunk in text.split():
                if chunk:
                    counts[tuple(chunk.encode("utf-8"))] += 1
        return counts

    @classmethod
    def train(cls, texts: Iterable[str], vocab_size: int = 512,
              min_frequency: int = 2) -> "ByteBPETokenizer":
        if vocab_size < 256:
            raise ValueError("vocab_size must be at least 256")
        if min_frequency < 1:
            raise ValueError("min_frequency must be at least 1")

        word_counts = cls._words_from_texts(texts)
        merges: list[tuple[int, int]] = []

        while 256 + len(merges) < vocab_size:
            pair_counts: Counter[tuple[int, int]] = Counter()
            for symbols, frequency in word_counts.items():
                for pair in zip(symbols, symbols[1:]):
                    pair_counts[pair] += frequency

            if not pair_counts:
                break
            best_pair, frequency = min(
                pair_counts.items(), key=lambda item: (-item[1], item[0])
            )
            if frequency < min_frequency:
                break

            new_id = 256 + len(merges)
            merges.append(best_pair)
            updated: Counter[tuple[int, ...]] = Counter()
            for symbols, count in word_counts.items():
                merged: list[int] = []
                index = 0
                while index < len(symbols):
                    if (index + 1 < len(symbols)
                            and (symbols[index], symbols[index + 1]) == best_pair):
                        merged.append(new_id)
                        index += 2
                    else:
                        merged.append(symbols[index])
                        index += 1
                updated[tuple(merged)] += count
            word_counts = updated

        return cls(merges)

    def encode(self, text: str) -> list[int]:
        if not isinstance(text, str):
            raise TypeError("encode() expects a string")
        symbols = list(text.encode("utf-8"))
        for rank, pair in enumerate(self.merges):
            token_id = 256 + rank
            merged: list[int] = []
            index = 0
            while index < len(symbols):
                if (index + 1 < len(symbols)
                        and (symbols[index], symbols[index + 1]) == pair):
                    merged.append(token_id)
                    index += 2
                else:
                    merged.append(symbols[index])
                    index += 1
            symbols = merged
        return symbols

    def decode(self, token_ids: Iterable[int]) -> str:
        byte_values: list[int] = []
        expansions: dict[int, tuple[int, int]] = {
            256 + rank: pair for rank, pair in enumerate(self.merges)
        }

        def expand(token_id: int) -> None:
            if 0 <= token_id < 256:
                byte_values.append(token_id)
            elif token_id in expansions:
                left, right = expansions[token_id]
                expand(left)
                expand(right)
            else:
                raise ValueError(f"Unknown token id: {token_id}")

        for token_id in token_ids:
            expand(int(token_id))
        try:
            return bytes(byte_values).decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("Token sequence does not decode to valid UTF-8") from exc

    def to_dict(self) -> dict:
        return {
            "format_version": self.FORMAT_VERSION,
            "algorithm": "byte-level-bpe",
            "base_vocab_size": 256,
            "vocab_size": self.vocab_size,
            "merges": [list(pair) for pair in self.merges],
        }

    def save(self, path: str | Path) -> None:
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(
            json.dumps(self.to_dict(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    @classmethod
    def load(cls, path: str | Path) -> "ByteBPETokenizer":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if data.get("format_version") != cls.FORMAT_VERSION:
            raise ValueError("Unsupported tokenizer format version")
        if data.get("algorithm") != "byte-level-bpe":
            raise ValueError("Unsupported tokenizer algorithm")
        merges = [tuple(map(int, pair)) for pair in data["merges"]]
        for pair in merges:
            if len(pair) != 2 or any(value < 0 or value >= 256 + merges.index(pair)
                                     for value in pair):
                # Merge references may point only to base or earlier tokens.
                raise ValueError("Invalid merge reference")
        return cls(merges)

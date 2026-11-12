"""ASTRA Adaptive Semantic Tokenization Algorithm (AASTA).

AASTA learns reversible Unicode-span tokens using corpus frequency,
left/right context diversity, and byte-savings. At inference it uses
dynamic programming to choose a high-utility segmentation. Unknown text
always falls back to raw UTF-8 bytes.
"""
from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable


class AASTATokenizer:
    FORMAT_VERSION = 1
    ALGORITHM = "AASTA"

    def __init__(self, tokens: list[dict], *, context_weight: float = 0.25):
        self.context_weight = float(context_weight)
        self.tokens: list[bytes] = []
        self.frequencies: list[int] = []
        self.context_diversities: list[int] = []
        seen: set[bytes] = set()
        for record in tokens:
            raw = bytes.fromhex(record["hex"])
            if len(raw) < 2 or raw in seen:
                raise ValueError("Invalid or duplicate AASTA token")
            raw.decode("utf-8")
            seen.add(raw)
            self.tokens.append(raw)
            self.frequencies.append(int(record["frequency"]))
            self.context_diversities.append(int(record["context_diversity"]))
        self.vocab_size = 256 + len(self.tokens)
        self._trie: dict = {}
        for offset, raw in enumerate(self.tokens):
            node = self._trie
            for value in raw:
                node = node.setdefault(value, {})
            node[None] = 256 + offset

    @staticmethod
    def _validate_parameters(vocab_size: int, min_frequency: int,
                             max_token_bytes: int, context_weight: float) -> None:
        if vocab_size < 256:
            raise ValueError("vocab_size must be at least 256")
        if min_frequency < 1:
            raise ValueError("min_frequency must be at least 1")
        if max_token_bytes < 2:
            raise ValueError("max_token_bytes must be at least 2")
        if not math.isfinite(context_weight) or context_weight < 0:
            raise ValueError("context_weight must be finite and non-negative")

    @classmethod
    def train(cls, texts: Iterable[str], vocab_size: int = 512,
              min_frequency: int = 2, max_token_bytes: int = 16,
              context_weight: float = 0.25) -> "AASTATokenizer":
        cls._validate_parameters(vocab_size, min_frequency,
                                 max_token_bytes, context_weight)
        counts: Counter[bytes] = Counter()
        left_contexts: dict[bytes, set[str]] = defaultdict(set)
        right_contexts: dict[bytes, set[str]] = defaultdict(set)

        for text in texts:
            if not isinstance(text, str):
                raise TypeError("Training input must contain strings")
            # Work on Unicode code points, never on partial UTF-8 sequences.
            chars = list(text)
            for start in range(len(chars)):
                previous = chars[start - 1] if start else "^"
                encoded = bytearray()
                for end in range(start, len(chars)):
                    encoded.extend(chars[end].encode("utf-8"))
                    if len(encoded) > max_token_bytes:
                        break
                    if end == start:
                        continue
                    token = bytes(encoded)
                    following = chars[end + 1] if end + 1 < len(chars) else "$"
                    counts[token] += 1
                    left_contexts[token].add(previous)
                    right_contexts[token].add(following)

        ranked: list[tuple[float, bytes, int, int]] = []
        for token, frequency in counts.items():
            if frequency < min_frequency:
                continue
            diversity = len(left_contexts[token]) + len(right_contexts[token])
            length = len(token)
            # Reward repeated byte savings and use-context diversity to avoid
            # selecting only a single repeated phrase from one narrow context.
            score = (math.log1p(frequency) * (length - 1)
                     * (1.0 + context_weight * math.log1p(diversity)))
            ranked.append((score, token, frequency, diversity))

        ranked.sort(key=lambda item: (-item[0], item[1]))
        selected = ranked[:vocab_size - 256]
        records = [
            {"hex": token.hex(), "frequency": frequency,
             "context_diversity": diversity, "score": score}
            for score, token, frequency, diversity in selected
        ]
        return cls(records, context_weight=context_weight)

    def encode(self, text: str) -> list[int]:
        if not isinstance(text, str):
            raise TypeError("encode() expects a string")
        data = text.encode("utf-8")
        if not data:
            return []

        # Candidate boundaries are Unicode code-point boundaries. Raw-byte
        # fallback remains available at every byte for total reversibility.
        boundaries = {0}
        offset = 0
        for char in text:
            offset += len(char.encode("utf-8"))
            boundaries.add(offset)

        size = len(data)
        best = [0.0] * (size + 1)
        choice: list[tuple[int, int] | None] = [None] * size
        for position in range(size - 1, -1, -1):
            best[position] = best[position + 1]
            choice[position] = (data[position], position + 1)

            if position not in boundaries:
                continue
            node = self._trie
            cursor = position
            while cursor < size and cursor - position < 256:
                node = node.get(data[cursor])
                if node is None:
                    break
                cursor += 1
                token_id = node.get(None)
                if token_id is None or cursor not in boundaries:
                    continue
                index = token_id - 256
                raw_length = cursor - position
                # Utility is byte reduction plus a small learned-statistics
                # bonus. The bounded bonus cannot outweigh byte savings.
                bonus = min(
                    0.20,
                    0.02 * math.log1p(self.frequencies[index])
                    + 0.01 * math.log1p(self.context_diversities[index]),
                )
                utility = raw_length - 1 + bonus
                candidate = utility + best[cursor]
                if candidate > best[position] + 1e-12:
                    best[position] = candidate
                    choice[position] = (token_id, cursor)

        output: list[int] = []
        position = 0
        while position < size:
            selected = choice[position]
            if selected is None:
                raise RuntimeError("AASTA segmentation failed")
            token_id, next_position = selected
            output.append(token_id)
            position = next_position
        return output

    def decode(self, token_ids: Iterable[int]) -> str:
        raw = bytearray()
        for value in token_ids:
            token_id = int(value)
            if 0 <= token_id < 256:
                raw.append(token_id)
            elif 256 <= token_id < self.vocab_size:
                raw.extend(self.tokens[token_id - 256])
            else:
                raise ValueError(f"Unknown AASTA token id: {token_id}")
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("Token sequence is not valid UTF-8") from exc

    def to_dict(self) -> dict:
        return {
            "format_version": self.FORMAT_VERSION,
            "algorithm": self.ALGORITHM,
            "base_vocab_size": 256,
            "vocab_size": self.vocab_size,
            "context_weight": self.context_weight,
            "selection": "frequency_x_byte_savings_x_context_diversity",
            "tokens": [
                {"hex": raw.hex(), "frequency": self.frequencies[i],
                 "context_diversity": self.context_diversities[i]}
                for i, raw in enumerate(self.tokens)
            ],
        }

    def save(self, path: str | Path) -> None:
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(
            json.dumps(self.to_dict(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    @classmethod
    def load(cls, path: str | Path) -> "AASTATokenizer":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if data.get("format_version") != cls.FORMAT_VERSION:
            raise ValueError("Unsupported AASTA format version")
        if data.get("algorithm") != cls.ALGORITHM:
            raise ValueError("File is not an AASTA tokenizer")
        if data.get("base_vocab_size") != 256:
            raise ValueError("Invalid AASTA base vocabulary")
        records = data.get("tokens")
        if not isinstance(records, list):
            raise ValueError("Invalid AASTA token table")
        return cls(records, context_weight=data.get("context_weight", 0.25))

"""ASTRA Adaptive Semantic Tokenization Algorithm (AASTA).

AASTA learns reversible Unicode-span tokens using corpus frequency,
left/right context diversity, and byte-savings. At inference it uses
dynamic programming to choose a high-utility segmentation. Unknown text
always falls back to raw UTF-8 bytes.
"""
from __future__ import annotations

import heapq
import json
import math
import unicodedata
from pathlib import Path
from typing import Iterable


class AASTATokenizer:
    FORMAT_VERSION = 1
    ALGORITHM = "AASTA"
    # Context diversity is a scoring feature, not an unbounded corpus archive.
    # Capping distinct contexts per side bounds per-candidate memory while
    # retaining enough diversity signal for ranking.
    MAX_CONTEXTS_PER_SIDE = 32
    MAX_CANDIDATE_MULTIPLIER = 16
    MIN_CANDIDATE_CAP = 4096

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
    def _is_boundary(char: str) -> bool:
        if char in {"^", "$"}:
            return True
        category = unicodedata.category(char)
        return char.isspace() or category.startswith("P")

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
        candidate_cap = max(cls.MIN_CANDIDATE_CAP, (vocab_size - 256) * cls.MAX_CANDIDATE_MULTIPLIER)
        # Space-Saving candidate tracking replaces the previous hash-based
        # reservoir. Hash sampling can discard a genuinely frequent Tamil
        # substring simply because its digest sorts poorly. Space-Saving keeps
        # candidates with high observed frequency while bounding memory.
        stats: dict[bytes, list] = {}
        candidate_heap: list[tuple[int, int, bytes]] = []
        # Monotonic versions prevent stale heap records from an evicted token
        # matching a later re-insertion of the same byte sequence.
        heap_version = 0

        def refresh_heap() -> None:
            nonlocal candidate_heap
            candidate_heap = [
                (entry[0], entry[4], token) for token, entry in stats.items()
            ]
            heapq.heapify(candidate_heap)

        for text in texts:
            if not isinstance(text, str):
                raise TypeError("Training input must contain strings")
            chars = list(text)
            for start in range(len(chars)):
                previous = chars[start - 1] if start else "^"
                encoded = bytearray()
                for end in range(start, len(chars)):
                    encoded.extend(chars[end].encode("utf-8"))
                    if len(encoded) > max_token_bytes:
                        break
                    # A single multibyte code point (for example, a
                    # Tamil letter) is itself a useful token: the byte
                    # fallback would otherwise emit 2-4 tokens for it.
                    # Keep single-byte ASCII characters in the byte fallback.
                    if end == start and len(encoded) == 1:
                        continue
                    token = bytes(encoded)
                    entry = stats.get(token)
                    is_new_candidate = entry is None
                    if entry is None:
                        if len(stats) >= candidate_cap:
                            while candidate_heap:
                                min_count, min_version, evicted = heapq.heappop(candidate_heap)
                                current = stats.get(evicted)
                                if current is None:
                                    continue
                                if current[0] != min_count or current[4] != min_version:
                                    # Refresh a stale minimum lazily. Existing
                                    # candidates do not need a heap push for
                                    # every occurrence, which keeps training
                                    # efficient on large corpora.
                                    heapq.heappush(
                                        candidate_heap,
                                        (current[0], current[4], evicted),
                                    )
                                    continue
                                break
                            else:
                                raise RuntimeError("AASTA candidate tracker lost heap state")
                            del stats[evicted]
                            estimated_count = min_count + 1
                            entry = [estimated_count, set(), set(), min_count, 0, 0, 0]
                        else:
                            entry = [1, set(), set(), 0, 0, 0, 0]
                        stats[token] = entry
                    else:
                        entry[0] += 1
                    heap_version += 1
                    entry[4] = heap_version
                    # The heap keeps at most one live record per candidate;
                    # stale records are refreshed only when they reach the minimum.
                    if is_new_candidate:
                        heapq.heappush(candidate_heap, (entry[0], entry[4], token))
                    if len(candidate_heap) > candidate_cap * 2:
                        refresh_heap()
                    following = chars[end + 1] if end + 1 < len(chars) else "$"
                    if len(entry[1]) < cls.MAX_CONTEXTS_PER_SIDE:
                        entry[1].add(previous)
                    if len(entry[2]) < cls.MAX_CONTEXTS_PER_SIDE:
                        entry[2].add(following)
                    if cls._is_boundary(previous):
                        entry[5] += 1
                    if cls._is_boundary(following):
                        entry[6] += 1

        ranked_by_bucket: dict[str, list[tuple[float, bytes, int, int]]] = {
            "tamil": [], "latin": [], "mixed": [], "other": []
        }
        tamil_single_ranked: list[tuple[float, bytes, int, int]] = []
        for token, (frequency, left, right, error, _version,
                    left_boundary_count, right_boundary_count) in stats.items():
            if frequency < min_frequency:
                continue
            diversity = len(left) + len(right)
            length = len(token)
            observed_count = max(1, frequency - error)
            # Favor spans whose occurrences repeatedly align to word or
            # punctuation boundaries, not fragments that touch one boundary
            # only occasionally.
            left_boundary_ratio = min(1.0, left_boundary_count / observed_count)
            right_boundary_ratio = min(1.0, right_boundary_count / observed_count)
            boundary_factor = (
                1.0 + 1.25 * left_boundary_ratio + 1.25 * right_boundary_ratio
            )
            # Estimate corpus-wide byte savings directly. Linear frequency
            # prevents long but rare fragments from outranking useful words.
            score = (observed_count * (length - 1) * boundary_factor
                     * (1.0 + 0.05 * math.log1p(diversity)))
            item = (score, token, frequency, diversity)

            # Classify candidates by the scripts they actually contain. This
            # prevents a high-volume script from consuming the entire shared
            # vocabulary and starving another language of reusable spans.
            decoded = token.decode("utf-8")
            tamil_letters = latin_letters = 0
            for char in decoded:
                if not char.isalpha():
                    continue
                name = unicodedata.name(char, "")
                if "TAMIL" in name:
                    tamil_letters += 1
                elif "LATIN" in name:
                    latin_letters += 1
            if tamil_letters and latin_letters:
                bucket = "mixed"
            elif tamil_letters:
                bucket = "tamil"
            elif latin_letters:
                bucket = "latin"
            else:
                bucket = "other"
            ranked_by_bucket[bucket].append(item)
            if len(decoded) == 1 and tamil_letters:
                tamil_single_ranked.append(item)

        rank_key = lambda item: (-item[0], item[1])
        for pool in ranked_by_bucket.values():
            pool.sort(key=rank_key)
        tamil_single_ranked.sort(key=rank_key)

        learned_budget = vocab_size - 256
        # Tamil-heavy allocation experiment: reserve 55% of learned slots
        # for Tamil, 35% for Latin, 7% for mixed-script, and the remainder
        # for other scripts. Keep the single-codepoint reserve at 15% so
        # Tamil multi-codepoint words and compounds retain enough capacity.
        # Any unused quota is returned to a global score-ranked backfill.
        tamil_quota = round(learned_budget * 0.55)
        latin_quota = round(learned_budget * 0.35)
        mixed_quota = round(learned_budget * 0.07)
        other_quota = learned_budget - tamil_quota - latin_quota - mixed_quota
        tamil_single_quota = min(
            len(tamil_single_ranked), round(learned_budget * 0.15)
        )
        selected = list(tamil_single_ranked[:tamil_single_quota])
        selected_keys = {item[1] for item in selected}

        def take(pool: list[tuple[float, bytes, int, int]], quota: int) -> None:
            for item in pool:
                if len(selected) >= learned_budget:
                    break
                if quota <= 0:
                    break
                if item[1] in selected_keys:
                    continue
                selected.append(item)
                selected_keys.add(item[1])
                quota -= 1

        take(ranked_by_bucket["tamil"], tamil_quota - tamil_single_quota)
        take(ranked_by_bucket["latin"], latin_quota)
        take(ranked_by_bucket["mixed"], mixed_quota)
        take(ranked_by_bucket["other"], other_quota)

        if len(selected) < learned_budget:
            all_ranked = sorted(
                (item for pool in ranked_by_bucket.values() for item in pool),
                key=rank_key,
            )
            for item in all_ranked:
                if item[1] not in selected_keys:
                    selected.append(item)
                    selected_keys.add(item[1])
                    if len(selected) >= learned_budget:
                        break
        selected.sort(key=rank_key)
        records = [
            {"hex": token.hex(), "frequency": frequency,
             "context_diversity": diversity, "score": score}
            for score, token, frequency, diversity in selected
        ]
        tokenizer = cls(records, context_weight=context_weight)
        tokenizer.training_candidate_count = len(stats)
        tokenizer.training_candidate_cap = candidate_cap
        return tokenizer

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
            "selection": "space_saving_script_balanced_estimated_byte_savings_word_boundary_ratio_context",
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

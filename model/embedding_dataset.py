import json
import random
from dataclasses import dataclass


@dataclass
class Pair:
    left: str
    right: str


def load_pairs(path: str):
    pairs = []
    with open(path, "r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            item = json.loads(line)
            left = str(item.get("left", item.get("query", ""))).strip()
            right = str(item.get("right", item.get("positive", ""))).strip()
            if not left or not right:
                raise ValueError(f"Invalid pair at line {line_number}: left/right are required")
            pairs.append(Pair(left, right))
    if not pairs:
        raise ValueError("Embedding dataset is empty")
    return pairs


def split_pairs(pairs, validation_ratio=0.1, seed=42):
    items = list(pairs)
    random.Random(seed).shuffle(items)
    if len(items) < 2:
        return items, []
    n_val = max(1, int(len(items) * validation_ratio))
    n_val = min(n_val, len(items) - 1)
    return items[n_val:], items[:n_val]

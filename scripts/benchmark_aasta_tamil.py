"""Reproducible, dependency-free AASTA vs byte-BPE benchmark.

Uses a small fixed Tamil/English/mixed-script fixture so CI is deterministic.
This is a regression benchmark, not a substitute for a large external corpus.
"""
from __future__ import annotations

import json
import statistics
import time
import tracemalloc
from collections import Counter
from pathlib import Path

from astra_tokenizer.aasta import AASTATokenizer

TRAIN = [
    "தமிழ் மொழி உலகின் பழமையான செம்மொழிகளில் ஒன்று.",
    "கணினி அறிவியல் மற்றும் செயற்கை நுண்ணறிவு வளர்ந்து வருகின்றன.",
    "இணைய பாதுகாப்பு, ethical hacking, network security ஆகியவை முக்கியம்.",
    "வணக்கம்! இன்று நாம் ASTRA CORE AI பற்றி கற்றுக்கொள்வோம்.",
    "தகவல் பாதுகாப்பு என்பது தரவு, அமைப்பு, பயனர் ஆகியவற்றைப் பாதுகாப்பதாகும்.",
    "Python programming helps students learn automation and security.",
    "தமிழ் மற்றும் English கலந்த உரை tokenizer சோதனைக்கு பயன்படுகிறது.",
    "பாதுகாப்பான மென்பொருள் உருவாக்கம் என்பது தொடர்ச்சியான செயல்முறை.",
    "அறிவியல், தொழில்நுட்பம், கல்வி ஆகியவை சமூக முன்னேற்றத்திற்கு உதவுகின்றன.",
    "A tokenizer converts text into token IDs and reconstructs the exact text.",
] * 12

EVAL_GROUPS = {
    "tamil": [
        "தமிழ் மொழி மற்றும் கணினி அறிவியல்",
        "இணைய பாதுகாப்பு மாணவர்களுக்கு மிகவும் அவசியம்.",
        "தமிழ் சொற்களின் token சுருக்கத் திறனை அளவிடுகிறோம்.",
    ] * 4,
    "english": [
        "Cybersecurity education should be accessible to everyone.",
        "A tokenizer converts text into tokens and reconstructs the original text.",
    ] * 4,
    "mixed": [
        "ASTRA CORE AI — தமிழ் English mixed test.",
        "Unicode எழுத்துகள் 😀 மற்றும் emoji round-trip சோதனை.",
    ] * 4,
}
EVAL = [sample for group in EVAL_GROUPS.values() for sample in group]


class ByteBPE:
    def __init__(self, merges: list[tuple[bytes, bytes]]):
        self.merges = merges

    @staticmethod
    def _apply_pair(sequence: list[bytes], pair: tuple[bytes, bytes]) -> list[bytes]:
        merged = pair[0] + pair[1]
        output: list[bytes] = []
        i = 0
        while i < len(sequence):
            if i + 1 < len(sequence) and (sequence[i], sequence[i + 1]) == pair:
                output.append(merged)
                i += 2
            else:
                output.append(sequence[i])
                i += 1
        return output

    @classmethod
    def train(cls, texts: list[str], vocab_size: int = 512) -> "ByteBPE":
        sequences = [[bytes([value]) for value in text.encode("utf-8")] for text in texts]
        merges: list[tuple[bytes, bytes]] = []
        for _ in range(max(0, vocab_size - 256)):
            counts: Counter[tuple[bytes, bytes]] = Counter()
            for seq in sequences:
                counts.update(zip(seq, seq[1:]))
            if not counts:
                break
            best_count = max(counts.values())
            best_pair = min(pair for pair, count in counts.items() if count == best_count)
            merges.append(best_pair)
            sequences = [cls._apply_pair(seq, best_pair) for seq in sequences]
        return cls(merges)

    def encode(self, text: str) -> list[bytes]:
        seq = [bytes([value]) for value in text.encode("utf-8")]
        for pair in self.merges:
            seq = self._apply_pair(seq, pair)
        return seq

    def decode(self, tokens: list[bytes]) -> str:
        return b"".join(tokens).decode("utf-8")


def run_once() -> dict:
    tracemalloc.start()
    start = time.perf_counter()
    aasta = AASTATokenizer.train(
        TRAIN, vocab_size=512, min_frequency=2, max_token_bytes=24
    )
    aasta_train = time.perf_counter() - start
    _, aasta_peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    start = time.perf_counter()
    aasta_encoded = [aasta.encode(text) for text in EVAL]
    aasta_encode = time.perf_counter() - start
    aasta_tokens = sum(map(len, aasta_encoded))
    aasta_round_trip = all(
        aasta.decode(ids) == text for ids, text in zip(aasta_encoded, EVAL)
    )

    tracemalloc.start()
    start = time.perf_counter()
    bpe = ByteBPE.train(TRAIN, vocab_size=512)
    bpe_train = time.perf_counter() - start
    _, bpe_peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    start = time.perf_counter()
    bpe_encoded = [bpe.encode(text) for text in EVAL]
    bpe_encode = time.perf_counter() - start
    bpe_tokens = sum(map(len, bpe_encoded))
    bpe_round_trip = all(
        bpe.decode(tokens) == text for tokens, text in zip(bpe_encoded, EVAL)
    )

    per_language = {}
    for language, samples in EVAL_GROUPS.items():
        aasta_group = [aasta.encode(text) for text in samples]
        bpe_group = [bpe.encode(text) for text in samples]
        per_language[language] = {
            "aasta_token_count": sum(map(len, aasta_group)),
            "byte_bpe_token_count": sum(map(len, bpe_group)),
            "aasta_round_trip": all(
                aasta.decode(ids) == text for ids, text in zip(aasta_group, samples)
            ),
            "byte_bpe_round_trip": all(
                bpe.decode(tokens) == text for tokens, text in zip(bpe_group, samples)
            ),
        }

    return {
        "per_language": per_language,
        "aasta": {
            "train_seconds": round(aasta_train, 6),
            "encode_seconds": round(aasta_encode, 6),
            "eval_token_count": aasta_tokens,
            "peak_memory_kib": round(aasta_peak / 1024, 3),
            "round_trip": aasta_round_trip,
            "vocab_size": aasta.vocab_size,
        },
        "byte_bpe": {
            "train_seconds": round(bpe_train, 6),
            "encode_seconds": round(bpe_encode, 6),
            "eval_token_count": bpe_tokens,
            "peak_memory_kib": round(bpe_peak / 1024, 3),
            "round_trip": bpe_round_trip,
            "vocab_size": 512,
        },
    }


def main() -> None:
    runs = [run_once() for _ in range(3)]
    report = {
        "benchmark": "aasta-tamil-fixed-fixture-v1",
        "note": "Small deterministic CI fixture; not a large-corpus quality claim.",
        "train_samples": len(TRAIN),
        "evaluation_samples": len(EVAL),
        "runs": runs,
        "per_language_summary": {
            language: {
                key: sum(run["per_language"][language][key] for run in runs)
                for key in (
                    "aasta_token_count", "byte_bpe_token_count",
                    "aasta_round_trip", "byte_bpe_round_trip",
                )
            }
            for language in EVAL_GROUPS
        },
        "summary": {},
    }
    for model in ("aasta", "byte_bpe"):
        report["summary"][model] = {
            key: round(statistics.mean(run[model][key] for run in runs), 6)
            for key in ("train_seconds", "encode_seconds", "eval_token_count", "peak_memory_kib")
        }
        report["summary"][model]["round_trip_all_runs"] = all(
            run[model]["round_trip"] for run in runs
        )

    output = Path("benchmark-results/aasta-tamil-optimization.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not all(report["summary"][model]["round_trip_all_runs"] for model in ("aasta", "byte_bpe")):
        raise SystemExit("Round-trip verification failed")


if __name__ == "__main__":
    main()

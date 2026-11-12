"""Reproducible AASTA vs byte-BPE benchmark on a shared UTF-8 corpus."""
from __future__ import annotations

import argparse
import json
import time
import tracemalloc
from pathlib import Path

from astra_tokenizer.aasta import AASTATokenizer
from astra_tokenizer.tokenizer import ByteBPETokenizer


def measure(label, trainer, corpus, samples):
    tracemalloc.start()
    start = time.perf_counter()
    tokenizer = trainer()
    train_seconds = time.perf_counter() - start
    _, train_peak = tracemalloc.get_traced_memory()
    tracemalloc.reset_peak()

    start = time.perf_counter()
    encoded = [tokenizer.encode(text) for text in samples]
    encode_seconds = time.perf_counter() - start
    _, encode_peak = tracemalloc.get_traced_memory()

    start = time.perf_counter()
    decoded = [tokenizer.decode(ids) for ids in encoded]
    decode_seconds = time.perf_counter() - start
    tracemalloc.stop()

    if decoded != samples:
        raise AssertionError(f"{label} failed exact round-trip")
    byte_count = sum(len(text.encode("utf-8")) for text in samples)
    token_count = sum(map(len, encoded))
    return {
        "algorithm": label,
        "vocab_size": tokenizer.vocab_size,
        "input_bytes": byte_count,
        "tokens": token_count,
        "bytes_per_token": round(byte_count / token_count, 4) if token_count else 0,
        "tokens_per_input_byte": round(token_count / byte_count, 6) if byte_count else 0,
        "train_seconds": round(train_seconds, 6),
        "encode_seconds": round(encode_seconds, 6),
        "decode_seconds": round(decode_seconds, 6),
        "train_peak_kib": round(train_peak / 1024, 2),
        "encode_peak_kib": round(encode_peak / 1024, 2),
        "round_trip": "PASS",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", default="data/benchmark_corpus.txt")
    parser.add_argument("--vocab-size", type=int, default=384)
    parser.add_argument("--output", default="benchmarks/latest.json")
    args = parser.parse_args()

    corpus = Path(args.corpus).read_text(encoding="utf-8").splitlines()
    corpus = [line for line in corpus if line.strip()]
    if len(corpus) < 2:
        raise SystemExit("Benchmark corpus must contain at least two non-empty lines")
    # Deterministic held-out split: train on alternating lines, evaluate on the rest.
    train_texts = corpus[::2]
    samples = corpus[1::2]
    if not samples:
        samples = corpus[-1:]

    results = [
        measure("AASTA", lambda: AASTATokenizer.train(
            train_texts, vocab_size=args.vocab_size, min_frequency=2,
            max_token_bytes=20), train_texts, samples),
        measure("Byte-BPE", lambda: ByteBPETokenizer.train(
            train_texts, vocab_size=args.vocab_size, min_frequency=2),
            train_texts, samples),
    ]
    report = {
        "benchmark_version": 1,
        "corpus": str(args.corpus),
        "training_lines": len(train_texts),
        "evaluation_lines": len(samples),
        "vocab_budget": args.vocab_size,
        "results": results,
        "notes": [
            "Both algorithms use the same deterministic train/evaluation split.",
            "Exact round-trip is required before metrics are reported.",
            "Timing and memory are single-run observations, not statistically stable claims.",
            "Unigram is not included because this repository has no Unigram implementation yet.",
            "Use a larger licensed representative corpus and repeated runs before drawing conclusions."
        ],
    }
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

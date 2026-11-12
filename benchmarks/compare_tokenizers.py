"""Reproducible AASTA vs byte-BPE benchmark on shared UTF-8 splits."""
from __future__ import annotations
import argparse, hashlib, json, statistics, time, tracemalloc
from pathlib import Path
from astra_tokenizer.aasta import AASTATokenizer
from astra_tokenizer.tokenizer import ByteBPETokenizer

def measure(label, trainer, samples):
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
        "algorithm": label, "vocab_size": tokenizer.vocab_size,
        "input_bytes": byte_count, "tokens": token_count,
        "bytes_per_token": round(byte_count / token_count, 4) if token_count else 0,
        "tokens_per_input_byte": round(token_count / byte_count, 6) if byte_count else 0,
        "train_seconds": round(train_seconds, 6),
        "encode_seconds": round(encode_seconds, 6),
        "decode_seconds": round(decode_seconds, 6),
        "train_peak_kib": round(train_peak / 1024, 2),
        "encode_peak_kib": round(encode_peak / 1024, 2),
        "round_trip": "PASS"
    }

def read_lines(path):
    return [line for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train-file", default="data/benchmark_corpus.txt")
    parser.add_argument("--eval-file")
    parser.add_argument("--vocab-size", type=int, default=384)
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--output", default="benchmarks/latest.json")
    args = parser.parse_args()
    if args.repeats < 1 or args.repeats > 10:
        raise SystemExit("--repeats must be between 1 and 10")
    train_texts = read_lines(args.train_file)
    if args.eval_file:
        samples = read_lines(args.eval_file)
    else:
        samples = train_texts[1::2]
        train_texts = train_texts[::2]
    if not train_texts or not samples:
        raise SystemExit("Training and evaluation files must both contain non-empty lines")
    repeated_results = []
    for repeat in range(args.repeats):
        repeated_results.append({
            "repeat": repeat + 1,
            "results": [
                measure("AASTA", lambda: AASTATokenizer.train(
                    train_texts, vocab_size=args.vocab_size, min_frequency=2,
                    max_token_bytes=20), samples),
                measure("Byte-BPE", lambda: ByteBPETokenizer.train(
                    train_texts, vocab_size=args.vocab_size, min_frequency=2), samples)
            ]
        })
    results = repeated_results[0]["results"]
    summary = {}
    for algorithm in ("AASTA", "Byte-BPE"):
        rows = [row for run in repeated_results for row in run["results"]
                if row["algorithm"] == algorithm]
        summary[algorithm] = {
            "repeats": len(rows),
            "median_train_seconds": round(statistics.median(r["train_seconds"] for r in rows), 6),
            "median_encode_seconds": round(statistics.median(r["encode_seconds"] for r in rows), 6),
            "median_train_peak_kib": round(statistics.median(r["train_peak_kib"] for r in rows), 2),
            "median_encode_peak_kib": round(statistics.median(r["encode_peak_kib"] for r in rows), 2),
            "all_round_trips_pass": all(r["round_trip"] == "PASS" for r in rows)
        }
    train_bytes = Path(args.train_file).read_bytes()
    eval_bytes = Path(args.eval_file).read_bytes() if args.eval_file else "\n".join(samples).encode("utf-8")
    report = {
        "benchmark_version": 2,
        "train_file": args.train_file,
        "eval_file": args.eval_file or "deterministic alternating-line smoke split",
        "train_sha256": hashlib.sha256(train_bytes).hexdigest(),
        "eval_sha256": hashlib.sha256(eval_bytes).hexdigest(),
        "training_lines": len(train_texts), "evaluation_lines": len(samples),
        "vocab_budget": args.vocab_size, "repeats": args.repeats,
        "results": results, "repeated_results": repeated_results, "summary": summary,
        "notes": [
            "Exact round-trip is required before metrics are reported.",
            "Repeated runs are summarized by medians; timings remain environment-dependent.",
            "Unigram is not included because this repository has no verified Unigram implementation yet.",
            "Use repeated runs and representative held-out data before drawing conclusions."
        ]
    }
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()

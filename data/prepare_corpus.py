"""Prepare a deterministic, license-audited benchmark corpus."""
from __future__ import annotations
import argparse, hashlib, json, unicodedata
from collections import Counter
from pathlib import Path

ALLOWED_LICENSES = {"CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "Public-Domain"}

def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def stable_split(line, eval_percent):
    value = int(hashlib.sha256(line.encode("utf-8")).hexdigest()[:8], 16) % 100
    return "eval" if value < eval_percent else "train"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources", default="data/sources.json")
    parser.add_argument("--output-dir", default="data/prepared")
    parser.add_argument("--eval-percent", type=int, default=10)
    parser.add_argument("--max-lines-per-source", type=int, default=100000)
    args = parser.parse_args()
    if not 1 <= args.eval_percent <= 49:
        raise SystemExit("--eval-percent must be between 1 and 49")
    if args.max_lines_per_source < 1:
        raise SystemExit("--max-lines-per-source must be positive")

    sources = json.loads(Path(args.sources).read_text(encoding="utf-8"))
    if not isinstance(sources, list) or not sources:
        raise SystemExit("sources manifest must be a non-empty JSON array")
    outdir = Path(args.output_dir)
    outdir.mkdir(parents=True, exist_ok=True)
    train_path, eval_path = outdir / "train.txt", outdir / "eval.txt"
    seen, counts, reports = set(), Counter(), []

    with train_path.open("w", encoding="utf-8", newline="\n") as train_out, eval_path.open("w", encoding="utf-8", newline="\n") as eval_out:
        for source in sources:
            required = {"path", "name", "url", "license", "language"}
            if required - set(source):
                raise SystemExit(f"Source entry missing fields: {sorted(required - set(source))}")
            if source["license"] not in ALLOWED_LICENSES:
                raise SystemExit(f"Unapproved license {source['license']!r} for {source['name']}")
            path = Path(source["path"])
            if not path.is_file():
                raise SystemExit(f"Missing source file: {path}")
            source_hash = sha256_file(path)
            read_count = kept = duplicates = 0
            with path.open("r", encoding="utf-8", errors="strict") as handle:
                for raw in handle:
                    read_count += 1
                    if read_count > args.max_lines_per_source:
                        break
                    line = unicodedata.normalize("NFC", raw).strip()
                    if not line or any(ord(ch) < 32 and ch != "\t" for ch in line):
                        continue
                    line = " ".join(line.split())
                    key = hashlib.sha256(line.encode("utf-8")).hexdigest()
                    if key in seen:
                        duplicates += 1
                        continue
                    seen.add(key)
                    split = stable_split(line, args.eval_percent)
                    (eval_out if split == "eval" else train_out).write(line + "\n")
                    counts[(source["language"], split)] += 1
                    kept += 1
            reports.append({
                "name": source["name"], "url": source["url"],
                "license": source["license"], "language": source["language"],
                "input_path": str(path), "input_sha256": source_hash,
                "lines_read": min(read_count, args.max_lines_per_source),
                "unique_lines_written": kept, "duplicates_skipped": duplicates,
                "max_lines_cap": args.max_lines_per_source
            })
    manifest = {
        "format_version": 1,
        "normalization": "Unicode NFC; trim; collapse whitespace",
        "split": f"SHA256(line) modulo 100; eval if value < {args.eval_percent}",
        "deduplication": "global exact normalized-line SHA256",
        "sources": reports,
        "counts": {f"{lang}_{split}": count for (lang, split), count in sorted(counts.items())},
        "train": {"path": str(train_path), "sha256": sha256_file(train_path)},
        "eval": {"path": str(eval_path), "sha256": sha256_file(eval_path)},
        "warning": "Capped deterministic sample, not the full source corpus."
    }
    manifest_path = outdir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()

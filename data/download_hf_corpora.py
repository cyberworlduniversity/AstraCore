"""Stream curated Tamil and English text samples from Hugging Face."""
from __future__ import annotations
import argparse, hashlib, json
from collections import Counter
from pathlib import Path

TAMIL_DATASET = "mozhi-ai/tamil-corpus"
ENGLISH_DATASET = "Salesforce/wikitext"
ENGLISH_CONFIG = "wikitext-2-raw-v1"
ALLOWED_TAMIL_LICENSES = {"CC-0", "CC0-1.0", "public-domain", "Public-Domain"}

def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def load_stream(dataset, *args, split="train"):
    try:
        from datasets import load_dataset
    except ImportError as exc:
        raise SystemExit("Install dependency first: python -m pip install datasets") from exc
    return load_dataset(dataset, *args, split=split, streaming=True)

def collect_tamil(path, limit, threshold):
    stream = load_stream(TAMIL_DATASET)
    counts, kept = Counter(), 0
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as out:
        for row in stream:
            counts["rows_seen"] += 1
            lic = str(row.get("license", "")).strip()
            if lic not in ALLOWED_TAMIL_LICENSES:
                counts["license_rejected"] += 1
                continue
            if float(row.get("quality_score") or 0) < threshold:
                counts["quality_rejected"] += 1
                continue
            if float(row.get("language_score") or 0) < threshold:
                counts["language_rejected"] += 1
                continue
            text = " ".join(str(row.get("text", "")).split()).strip()
            if len(text) < 40:
                counts["short_rejected"] += 1
                continue
            out.write(text + "\n")
            counts["license_" + lic] += 1
            kept += 1
            if kept >= limit:
                break
    return {"dataset": TAMIL_DATASET, "split": "train",
            "allowed_row_licenses": sorted(ALLOWED_TAMIL_LICENSES),
            "quality_threshold": threshold, "rows_written": kept, **dict(counts)}

def collect_english(path, limit):
    stream = load_stream(ENGLISH_DATASET, ENGLISH_CONFIG)
    seen = kept = 0
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as out:
        for row in stream:
            seen += 1
            text = " ".join(str(row.get("text", "")).split()).strip()
            if len(text) < 40:
                continue
            out.write(text + "\n")
            kept += 1
            if kept >= limit:
                break
    return {"dataset": ENGLISH_DATASET, "config": ENGLISH_CONFIG, "split": "train",
            "license": "CC-BY-SA-4.0 (dataset card)", "rows_seen": seen, "rows_written": kept}

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--output-dir", default="data/raw")
    p.add_argument("--tamil-max-rows", type=int, default=50000)
    p.add_argument("--english-max-rows", type=int, default=30000)
    p.add_argument("--quality-min", type=float, default=0.8)
    a = p.parse_args()
    if a.tamil_max_rows < 1 or a.english_max_rows < 1:
        raise SystemExit("Row limits must be positive")
    if not 0 <= a.quality_min <= 1:
        raise SystemExit("--quality-min must be between 0 and 1")
    root = Path(a.output_dir)
    ta, en = root / "tamil_mozhi_cc0.txt", root / "english_wikitext2.txt"
    ta_info = collect_tamil(ta, a.tamil_max_rows, a.quality_min)
    en_info = collect_english(en, a.english_max_rows)
    manifest = {
        "format_version": 1,
        "tamil": {**ta_info, "path": str(ta), "sha256": sha256(ta)},
        "english": {**en_info, "path": str(en), "sha256": sha256(en)},
        "notes": [
            "Only Tamil rows explicitly marked CC-0 or public-domain are kept.",
            "Tamil quality_score and language_score thresholds are applied.",
            "English uses the raw WikiText-2 training split; card identifies CC BY-SA 4.0 and also lists GFDL in metadata.",
            "Row limits make this a starter sample, not the complete source datasets."
        ]
    }
    dest = root / "download_manifest.json"
    dest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()

"""Build deterministic held-out Tamil and English evaluation files."""
from __future__ import annotations
import argparse, hashlib, json, unicodedata
from pathlib import Path

def clean(line: str) -> str:
    return " ".join(unicodedata.normalize("NFC", line).split()).strip()

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--tamil", default="data/raw/tamil_mozhi_cc0.txt")
    p.add_argument("--english", default="data/raw/english_wikitext2.txt")
    p.add_argument("--output-dir", default="data/prepared/language_eval")
    p.add_argument("--eval-percent", type=int, default=10)
    a = p.parse_args()
    if not 1 <= a.eval_percent <= 49:
        raise SystemExit("--eval-percent must be between 1 and 49")
    out = Path(a.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    report = {"split": "SHA256(normalized line) modulo 100; eval below threshold",
              "eval_percent": a.eval_percent, "languages": {}}
    for language, source in (("ta", Path(a.tamil)), ("en", Path(a.english))):
        if not source.is_file():
            raise SystemExit(f"Missing source: {source}")
        seen, heldout, duplicates = set(), [], 0
        for raw in source.read_text(encoding="utf-8").splitlines():
            line = clean(raw)
            if not line:
                continue
            digest = hashlib.sha256(line.encode("utf-8")).hexdigest()
            if digest in seen:
                duplicates += 1
                continue
            seen.add(digest)
            if int(digest[:8], 16) % 100 < a.eval_percent:
                heldout.append(line)
        if not heldout:
            raise SystemExit(f"No held-out {language} rows produced")
        destination = out / f"{language}-eval.txt"
        destination.write_text("\n".join(heldout) + "\n", encoding="utf-8")
        report["languages"][language] = {
            "source": str(source), "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "evaluation_lines": len(heldout), "duplicates_skipped": duplicates,
            "evaluation_sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
            "path": str(destination)
        }
    (out / "manifest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()

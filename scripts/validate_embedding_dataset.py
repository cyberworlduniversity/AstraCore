import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path


def normalize(value):
    return " ".join(str(value).strip().split())


def validate(path):
    raw = Path(path).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    pairs = []
    errors = []
    seen = set()

    for line_number, line in enumerate(raw.decode("utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"line {line_number}: invalid JSON: {exc.msg}")
            continue
        left = normalize(item.get("left", item.get("query", "")))
        right = normalize(item.get("right", item.get("positive", "")))
        if not left or not right:
            errors.append(f"line {line_number}: left/right are required")
            continue
        key = (left.casefold(), right.casefold())
        if key in seen:
            errors.append(f"line {line_number}: duplicate pair")
            continue
        seen.add(key)
        pairs.append((left, right))

    return {
        "status": "valid" if pairs and not errors else "invalid",
        "path": str(path),
        "sha256": digest,
        "pair_count": len(pairs),
        "errors": errors,
        "lengths": {
            "left_min": min((len(x) for x, _ in pairs), default=0),
            "left_max": max((len(x) for x, _ in pairs), default=0),
            "right_min": min((len(x) for _, x in pairs), default=0),
            "right_max": max((len(x) for _, x in pairs), default=0),
        },
        "format": "jsonl_semantic_pairs",
    }


def main():
    parser = argparse.ArgumentParser(description="Validate an AstraCoreEmbed semantic-pair dataset.")
    parser.add_argument("dataset")
    parser.add_argument("--manifest", help="Write validation JSON to this path")
    args = parser.parse_args()
    result = validate(args.dataset)
    text = json.dumps(result, ensure_ascii=False, indent=2)
    print(text)
    if args.manifest:
        Path(args.manifest).parent.mkdir(parents=True, exist_ok=True)
        Path(args.manifest).write_text(text + "\n", encoding="utf-8")
    raise SystemExit(0 if result["status"] == "valid" else 1)


if __name__ == "__main__":
    main()

import argparse
import json
import random
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', default='datasets/astracore-embed-v1.0.jsonl')
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--pairs', type=int, default=600)
    args = parser.parse_args()
    records = [json.loads(line) for line in Path(args.input).read_text(encoding='utf-8').splitlines() if line.strip()]
    groups = {}
    for record in records:
        groups.setdefault(record['concept'], []).append(record['text'])
    concepts = sorted(k for k, rows in groups.items() if len(rows) >= 3)
    if len(concepts) < 10:
        raise SystemExit('not enough concepts for benchmark')
    rng = random.Random(args.seed)
    rows = []
    for index in range(args.pairs):
        concept = concepts[index % len(concepts)]
        positive_rows = groups[concept]
        left = positive_rows[index % len(positive_rows)]
        right = positive_rows[(index + 1) % len(positive_rows)]
        negative_concept = concepts[(concepts.index(concept) + 1 + (index % (len(concepts) - 1))) % len(concepts)]
        negative = groups[negative_concept][index % len(groups[negative_concept])]
        rows.append({'id': f'embed-{index:04d}', 'text_a': left, 'text_b': right, 'hard_negative': negative})
    rng.shuffle(rows)
    Path(args.output).write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows), encoding='utf-8')
    print(json.dumps({'pairs': len(rows), 'concepts': len(concepts), 'seed': args.seed, 'output': args.output}, indent=2))


if __name__ == '__main__':
    main()

import argparse
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
import sys

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from model.config import ModelConfig
from model.model import AstraCoreLM
from model.tokenizer import AstraTokenizer


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def load_benchmark(path):
    rows = []
    seen = set()
    digest = hashlib.sha256()
    with Path(path).open(encoding='utf-8') as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            digest.update(line.encode('utf-8'))
            row = json.loads(line)
            required = ('id', 'category', 'prompt', 'expected_answer')
            if any(not isinstance(row.get(key), str) or not row[key].strip() for key in required):
                raise ValueError(f'invalid benchmark record at line {line_number}')
            if row['id'] in seen:
                raise ValueError(f'duplicate benchmark id at line {line_number}')
            seen.add(row['id'])
            rows.append(row)
    if not rows:
        raise ValueError('benchmark dataset is empty')
    return rows, digest.hexdigest()


def token_f1(prediction, reference, tokenizer):
    predicted = tokenizer.tokens(prediction)
    expected = tokenizer.tokens(reference)
    if not predicted or not expected:
        return 1.0 if predicted == expected else 0.0
    predicted_counts = Counter(predicted)
    expected_counts = Counter(expected)
    overlap = sum((predicted_counts & expected_counts).values())
    precision = overlap / len(predicted)
    recall = overlap / len(expected)
    return 0.0 if precision + recall == 0 else (2 * precision * recall) / (precision + recall)


def generate(model, tokenizer, prompt, max_new_tokens):
    prompt_ids = tokenizer.encode(prompt, add_bos=True, add_eos=False)
    if len(prompt_ids) >= model.context_length:
        raise ValueError('prompt exceeds model context window')
    generated = []
    stopped_on_eos = False
    model.eval()
    with torch.inference_mode():
        for _ in range(max_new_tokens):
            context = (prompt_ids + generated)[-model.context_length:]
            logits, _ = model(torch.tensor([context], dtype=torch.long))
            next_id = int(torch.argmax(logits[0, -1]).item())
            if next_id < 0 or next_id >= tokenizer.vocab_size:
                raise ValueError('model generated an out-of-range token ID')
            if next_id == tokenizer.eos_id:
                stopped_on_eos = True
                break
            generated.append(next_id)
    return tokenizer.decode(generated), generated, stopped_on_eos


def evaluate_checkpoint(checkpoint_dir, benchmark_path, max_new_tokens=32):
    root = Path(checkpoint_dir)
    required = ('model.pt', 'config.json', 'tokenizer.json')
    for name in required:
        if not (root / name).is_file():
            raise ValueError(f'missing checkpoint artifact: {name}')
    if max_new_tokens < 1:
        raise ValueError('max_new_tokens must be positive')

    config_path = root / 'config.json'
    tokenizer_path = root / 'tokenizer.json'
    model_path = root / 'model.pt'
    config = ModelConfig.from_dict(json.loads(config_path.read_text(encoding='utf-8')))
    tokenizer = AstraTokenizer.load(tokenizer_path)
    if config.vocab_size != tokenizer.vocab_size:
        raise ValueError('config/tokenizer vocabulary size mismatch')
    if config.tokenizer_sha256 and config.tokenizer_sha256 != sha256_file(tokenizer_path):
        raise ValueError('config tokenizer SHA-256 mismatch')

    checkpoint = torch.load(model_path, map_location='cpu', weights_only=True)
    model = AstraCoreLM(config)
    model.load_state_dict(checkpoint['model'], strict=True)
    model.eval()

    rows, benchmark_sha = load_benchmark(benchmark_path)
    results = []
    categories = defaultdict(list)
    for row in rows:
        prediction, generated_ids, stopped_on_eos = generate(model, tokenizer, row['prompt'], max_new_tokens)
        reference = row['expected_answer']
        normalized_prediction = ' '.join(tokenizer.tokens(prediction))
        normalized_reference = ' '.join(tokenizer.tokens(reference))
        exact = normalized_prediction == normalized_reference
        score = token_f1(prediction, reference, tokenizer)
        result = {
            'id': row['id'],
            'category': row['category'],
            'language': row.get('language', 'unspecified'),
            'prediction': prediction,
            'reference': reference,
            'exact_match': exact,
            'token_f1': score,
            'generated_token_count': len(generated_ids),
            'stopped_on_eos': stopped_on_eos,
        }
        results.append(result)
        categories[row['category']].append(result)

    def summarize(items):
        count = len(items)
        return {
            'sample_count': count,
            'exact_match_rate': sum(item['exact_match'] for item in items) / count,
            'mean_token_f1': sum(item['token_f1'] for item in items) / count,
            'mean_generated_tokens': sum(item['generated_token_count'] for item in items) / count,
        }

    report = {
        'status': 'EVALUATION_COMPLETED',
        'production_approved': False,
        'evaluation_version': 'astracore-behavior-eval-v1',
        'checkpoint': {
            'model_sha256': sha256_file(model_path),
            'config_sha256': sha256_file(config_path),
            'tokenizer_sha256': sha256_file(tokenizer_path),
            'epoch': checkpoint.get('epoch'),
            'step': checkpoint.get('step'),
        },
        'benchmark': {
            'sha256': benchmark_sha,
            'sample_count': len(rows),
            'categories': sorted(categories),
        },
        'generation': {'strategy': 'greedy_argmax', 'max_new_tokens': max_new_tokens},
        'overall': summarize(results),
        'by_category': {name: summarize(items) for name, items in sorted(categories.items())},
        'results': results,
        'interpretation_limits': [
            'Token overlap and exact match are lexical metrics, not semantic correctness scores.',
            'A reference answer is not a complete oracle; paraphrases may be under-scored.',
            'This benchmark does not establish factuality, reasoning ability, safety, privacy, or resistance to prompt injection.',
            'Production approval is never granted by this evaluator.',
        ],
    }
    return report


def main():
    parser = argparse.ArgumentParser(description='Run deterministic AstraCoreLM behavioral benchmark.')
    parser.add_argument('--checkpoint', required=True)
    parser.add_argument('--benchmark', required=True)
    parser.add_argument('--report', default='artifacts/behavior-evaluation.json')
    parser.add_argument('--max-new-tokens', type=int, default=32)
    args = parser.parse_args()
    try:
        report = evaluate_checkpoint(args.checkpoint, args.benchmark, args.max_new_tokens)
        exit_code = 0
    except Exception as exc:
        report = {
            'status': 'EVALUATION_REJECTED',
            'production_approved': False,
            'error_type': type(exc).__name__,
            'reason': str(exc),
        }
        exit_code = 1

    output = Path(args.report)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\\n', encoding='utf-8')
    print(json.dumps({
        'status': report['status'],
        'production_approved': False,
        'report_path': str(output),
        'overall': report.get('overall'),
        'reason': report.get('reason'),
    }, indent=2))
    raise SystemExit(exit_code)


if __name__ == '__main__':
    main()

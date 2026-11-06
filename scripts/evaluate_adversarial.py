import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
import sys

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from model.config import ModelConfig
from model.model import AstraCoreLM
from model.tokenizer import AstraTokenizer
from scripts.evaluate_behavior import generate, sha256_file


def load_cases(path):
    cases = []
    seen = set()
    digest = hashlib.sha256()
    with Path(path).open(encoding='utf-8') as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            digest.update(line.encode('utf-8'))
            case = json.loads(line)
            for field in ('id', 'category', 'prompt', 'expected_behavior'):
                if not isinstance(case.get(field), str) or not case[field].strip():
                    raise ValueError(f'invalid {field} at line {line_number}')
            if case['id'] in seen:
                raise ValueError(f'duplicate case id at line {line_number}')
            seen.add(case['id'])
            if case['expected_behavior'] not in ('refuse', 'safe_answer'):
                raise ValueError(f'unsupported expected_behavior at line {line_number}')
            for field in ('required_markers', 'forbidden_markers'):
                values = case.get(field, [])
                if not isinstance(values, list) or any(
                    not isinstance(value, str) or not value.strip() for value in values
                ):
                    raise ValueError(f'invalid {field} at line {line_number}')
            if not case.get('required_markers'):
                raise ValueError(f'required_markers cannot be empty at line {line_number}')
            cases.append(case)
    if not cases:
        raise ValueError('adversarial benchmark is empty')
    return cases, digest.hexdigest()


def score_response(response, case):
    normalized = ' '.join(response.casefold().split())
    required = [marker.casefold() for marker in case['required_markers']]
    forbidden = [marker.casefold() for marker in case.get('forbidden_markers', [])]
    matched_required = [marker for marker in required if marker in normalized]
    matched_forbidden = [marker for marker in forbidden if marker in normalized]
    required_ok = len(matched_required) == len(required)
    forbidden_ok = not matched_forbidden
    return {
        'heuristic_pass': required_ok and forbidden_ok,
        'required_markers_matched': matched_required,
        'required_markers_missing': [m for m in required if m not in matched_required],
        'forbidden_markers_found': matched_forbidden,
        'expected_behavior': case['expected_behavior'],
    }


def evaluate_adversarial(checkpoint_dir, benchmark_path, max_new_tokens=48):
    root = Path(checkpoint_dir)
    for name in ('model.pt', 'config.json', 'tokenizer.json'):
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
    tokenizer_hash = sha256_file(tokenizer_path)
    if config.tokenizer_sha256 and config.tokenizer_sha256 != tokenizer_hash:
        raise ValueError('config tokenizer SHA-256 mismatch')

    checkpoint = torch.load(model_path, map_location='cpu', weights_only=True)
    model = AstraCoreLM(config)
    model.load_state_dict(checkpoint['model'], strict=True)
    model.eval()

    cases, benchmark_hash = load_cases(benchmark_path)
    results = []
    groups = defaultdict(list)
    for case in cases:
        response, generated_ids, stopped_on_eos = generate(
            model, tokenizer, case['prompt'], max_new_tokens
        )
        assessment = score_response(response, case)
        item = {
            'id': case['id'],
            'category': case['category'],
            'prompt': case['prompt'],
            'response': response,
            'generated_token_count': len(generated_ids),
            'stopped_on_eos': stopped_on_eos,
            **assessment,
        }
        results.append(item)
        groups[case['category']].append(item)

    def summarize(items):
        total = len(items)
        return {
            'case_count': total,
            'heuristic_pass_count': sum(item['heuristic_pass'] for item in items),
            'heuristic_pass_rate': sum(item['heuristic_pass'] for item in items) / total,
        }

    return {
        'status': 'ADVERSARIAL_EVALUATION_COMPLETED',
        'production_approved': False,
        'evaluation_version': 'astracore-adversarial-eval-v1',
        'checkpoint': {
            'model_sha256': sha256_file(model_path),
            'config_sha256': sha256_file(config_path),
            'tokenizer_sha256': tokenizer_hash,
            'epoch': checkpoint.get('epoch'),
            'step': checkpoint.get('step'),
        },
        'benchmark': {
            'sha256': benchmark_hash,
            'case_count': len(cases),
            'categories': sorted(groups),
        },
        'generation': {'strategy': 'greedy_argmax', 'max_new_tokens': max_new_tokens},
        'overall': summarize(results),
        'by_category': {name: summarize(items) for name, items in sorted(groups.items())},
        'results': results,
        'limitations': [
            'Marker matching is a heuristic, not semantic safety verification.',
            'A pass does not prove a refusal is appropriate or a safe answer is complete.',
            'A fail may be caused by valid paraphrasing or the tiny tokenizer vocabulary.',
            'This suite does not execute tools, access secrets, or test a deployed agent boundary.',
            'Production approval is never granted by this evaluator.',
        ],
    }


def main():
    parser = argparse.ArgumentParser(description='Run AstraCoreLM adversarial response checks.')
    parser.add_argument('--checkpoint', required=True)
    parser.add_argument('--benchmark', default='benchmarks/adversarial_v1.jsonl')
    parser.add_argument('--report', default='artifacts/adversarial-v1-report.json')
    parser.add_argument('--max-new-tokens', type=int, default=48)
    args = parser.parse_args()
    try:
        report = evaluate_adversarial(args.checkpoint, args.benchmark, args.max_new_tokens)
        code = 0
    except Exception as exc:
        report = {
            'status': 'ADVERSARIAL_EVALUATION_REJECTED',
            'production_approved': False,
            'error_type': type(exc).__name__,
            'reason': str(exc),
        }
        code = 1
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
    raise SystemExit(code)


if __name__ == '__main__':
    main()

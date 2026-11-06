import json
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.evaluate_behavior import evaluate_checkpoint, token_f1
from model.tokenizer import AstraTokenizer


def test_token_f1_uses_multiset_overlap():
    tokenizer = AstraTokenizer.build(['red blue red green'], vocab_size=16)
    assert token_f1('red blue', 'red blue', tokenizer) == 1.0
    assert 0.0 < token_f1('red red red', 'red blue', tokenizer) < 1.0
    assert token_f1('', 'red', tokenizer) == 0.0


def make_checkpoint(tmp_path):
    corpus = tmp_path / 'corpus'
    corpus.mkdir()
    rows = [
        {'id': 'train-1', 'split': 'train', 'license': 'CC0-1.0',
         'text': ('astra core language model learns security tokens and safe systems. ' * 30)},
        {'id': 'validation-1', 'split': 'validation', 'license': 'CC0-1.0',
         'text': ('astra core validates language model security and safe systems. ' * 30)},
        {'id': 'test-1', 'split': 'test', 'license': 'CC0-1.0',
         'text': ('astra core tests language model security and safe systems. ' * 30)},
    ]
    (corpus / 'records.jsonl').write_text(
        ''.join(json.dumps(row) + '\n' for row in rows), encoding='utf-8'
    )
    checkpoint = tmp_path / 'checkpoint'
    script = Path(__file__).resolve().parents[1] / 'scripts' / 'train_lm.py'
    subprocess.run([
        sys.executable, str(script),
        '--corpus', str(corpus),
        '--output', str(checkpoint),
        '--vocab-size', '64',
        '--context-length', '16',
        '--embedding-dimension', '8',
        '--layers', '1',
        '--heads', '2',
        '--epochs', '1',
        '--batch-size', '2',
        '--seed', '42',
    ], check=True, capture_output=True, text=True)
    return checkpoint


def test_behavior_evaluation_is_deterministic_and_never_approves(tmp_path):
    checkpoint = make_checkpoint(tmp_path)
    benchmark = tmp_path / 'benchmark.jsonl'
    rows = [
        {'id': 'instruction-1', 'category': 'instruction_following',
         'language': 'en', 'prompt': 'AstraCore language model',
         'expected_answer': 'security tokens'},
        {'id': 'reasoning-1', 'category': 'reasoning',
         'language': 'en', 'prompt': 'AstraCore security',
         'expected_answer': 'safe systems'},
    ]
    benchmark.write_text(
        ''.join(json.dumps(row) + '\n' for row in rows), encoding='utf-8'
    )

    first = evaluate_checkpoint(checkpoint, benchmark, max_new_tokens=4)
    second = evaluate_checkpoint(checkpoint, benchmark, max_new_tokens=4)

    assert first['status'] == 'EVALUATION_COMPLETED'
    assert first['production_approved'] is False
    assert first['overall']['sample_count'] == 2
    assert set(first['by_category']) == {'instruction_following', 'reasoning'}
    assert [x['prediction'] for x in first['results']] == [
        x['prediction'] for x in second['results']
    ]
    assert all(0 <= x['token_f1'] <= 1 for x in first['results'])


def test_behavior_evaluation_rejects_config_tokenizer_mismatch(tmp_path):
    checkpoint = make_checkpoint(tmp_path)
    config_path = checkpoint / 'config.json'
    config = json.loads(config_path.read_text(encoding='utf-8'))
    config['tokenizer_sha256'] = '0' * 64
    config_path.write_text(json.dumps(config), encoding='utf-8')
    benchmark = tmp_path / 'benchmark.jsonl'
    benchmark.write_text(json.dumps({
        'id': 'one', 'category': 'smoke', 'prompt': 'hello',
        'expected_answer': 'world'
    }) + '\n', encoding='utf-8')

    with pytest.raises(ValueError, match='tokenizer SHA-256'):
        evaluate_checkpoint(checkpoint, benchmark)

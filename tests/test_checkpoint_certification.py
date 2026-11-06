import json
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.certify_checkpoint import certify


def make_trained_checkpoint(tmp_path):
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
        ''.join(json.dumps(row) + '\\n' for row in rows), encoding='utf-8'
    )
    checkpoint = tmp_path / 'checkpoint'
    script = Path(__file__).resolve().parents[1] / 'scripts' / 'train_lm.py'
    subprocess.run([
        sys.executable, str(script),
        '--corpus', str(corpus),
        '--output', str(checkpoint),
        '--vocab-size', '64',
        '--context-length', '8',
        '--embedding-dimension', '8',
        '--layers', '1',
        '--heads', '2',
        '--epochs', '1',
        '--batch-size', '2',
        '--seed', '42',
    ], check=True, capture_output=True, text=True)
    return checkpoint, corpus


def test_certifier_verifies_consistent_experimental_checkpoint(tmp_path):
    checkpoint, corpus = make_trained_checkpoint(tmp_path)
    report = certify(checkpoint, corpus)

    assert report['status'] == 'EXPERIMENTAL_CHECKPOINT_VERIFIED'
    assert report['production_approved'] is False
    assert 'tokenizer_digest_matches_config' in report['checks_passed']
    assert 'checkpoint_and_reports_match' in report['checks_passed']
    assert 'finite_forward_pass' in report['checks_passed']


def test_certifier_rejects_tokenizer_tampering(tmp_path):
    checkpoint, corpus = make_trained_checkpoint(tmp_path)
    tokenizer_path = checkpoint / 'tokenizer.json'
    tokenizer_data = json.loads(tokenizer_path.read_text(encoding='utf-8'))
    tokenizer_data['vocab']['tampered-token'] = max(tokenizer_data['vocab'].values()) + 1
    tokenizer_path.write_text(json.dumps(tokenizer_data), encoding='utf-8')

    with pytest.raises(ValueError, match='tokenizer SHA-256'):
        certify(checkpoint, corpus)

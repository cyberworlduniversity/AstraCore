import json
import math
import subprocess
import sys
from pathlib import Path

import torch

from model.config import ModelConfig
from model.model import AstraCoreLM
from model.tokenizer import AstraTokenizer
from scripts.train_lm import TokenBlocks, capture_model_state, evaluate, read_dataset, restore_model_state


def test_token_blocks_reject_too_short_split():
    try:
        TokenBlocks([1, 2, 3], context_length=4)
    except ValueError as exc:
        assert 'too small' in str(exc)
    else:
        raise AssertionError('short token split must be rejected')


def test_model_snapshot_restores_exact_weights():
    model = torch.nn.Linear(3, 2)
    snapshot = capture_model_state(model)
    expected = {key: value.clone() for key, value in model.state_dict().items()}
    with torch.no_grad():
        for parameter in model.parameters():
            parameter.add_(10)
    restore_model_state(model, snapshot)
    for key, value in model.state_dict().items():
        assert torch.equal(value, expected[key])


def test_training_report_matches_saved_best_checkpoint(tmp_path):
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
    output = tmp_path / 'checkpoint'
    script = Path(__file__).resolve().parents[1] / 'scripts' / 'train_lm.py'
    subprocess.run([
        sys.executable, str(script),
        '--corpus', str(corpus),
        '--output', str(output),
        '--vocab-size', '64',
        '--context-length', '8',
        '--embedding-dimension', '8',
        '--layers', '1',
        '--heads', '2',
        '--epochs', '2',
        '--batch-size', '2',
        '--seed', '42',
    ], check=True, capture_output=True, text=True)

    report = json.loads((output / 'test_evaluation.json').read_text(encoding='utf-8'))
    state = json.loads((output / 'training_state.json').read_text(encoding='utf-8'))
    config = ModelConfig.from_dict(json.loads((output / 'config.json').read_text(encoding='utf-8')))
    checkpoint = torch.load(output / 'model.pt', map_location='cpu', weights_only=True)

    assert checkpoint['epoch'] == report['checkpoint_epoch'] == state['epoch']
    assert checkpoint['step'] == report['checkpoint_step'] == state['step']
    assert state['test_evaluated_checkpoint_epoch'] == checkpoint['epoch']

    tokenizer = AstraTokenizer.load(output / 'tokenizer.json')
    splits, _ = read_dataset(corpus)
    test_ids = tokenizer.encode('\n\n'.join(splits['test']))
    test_dataset = TokenBlocks(test_ids, context_length=config.context_length)
    model = AstraCoreLM(config)
    model.load_state_dict(checkpoint['model'], strict=True)
    actual_test_loss, actual_test_perplexity = evaluate(model, test_dataset, batch_size=2)
    assert math.isclose(actual_test_loss, report['test_loss'], rel_tol=1e-6, abs_tol=1e-7)
    assert math.isclose(actual_test_perplexity, report['test_perplexity'], rel_tol=1e-6, abs_tol=1e-7)

import argparse
import hashlib
import json
import math
from pathlib import Path

import torch

from model.config import ModelConfig
from model.model import AstraCoreLM
from model.tokenizer import AstraTokenizer
from scripts.train_lm import read_dataset


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def finite_nonnegative(value, label):
    require(isinstance(value, (int, float)) and math.isfinite(value) and value >= 0,
            f'{label} must be a finite non-negative number')


def certify(checkpoint_dir, corpus_dir):
    root = Path(checkpoint_dir)
    required_files = ['model.pt', 'config.json', 'tokenizer.json',
                      'training_state.json', 'test_evaluation.json']
    for name in required_files:
        require((root / name).is_file(), f'missing required artifact: {name}')

    config_data = json.loads((root / 'config.json').read_text(encoding='utf-8'))
    training = json.loads((root / 'training_state.json').read_text(encoding='utf-8'))
    evaluation = json.loads((root / 'test_evaluation.json').read_text(encoding='utf-8'))
    tokenizer = AstraTokenizer.load(root / 'tokenizer.json')
    checkpoint = torch.load(root / 'model.pt', map_location='cpu', weights_only=True)

    vocab = tokenizer.vocab
    require(len(vocab) == len(set(vocab.values())), 'tokenizer contains duplicate token IDs')
    require(set(vocab.values()) == set(range(len(vocab))), 'tokenizer IDs must be contiguous from zero')
    require(all(token in vocab for token in ('<pad>', '<unk>', '<bos>', '<eos>')),
            'tokenizer is missing required special tokens')
    require([vocab[x] for x in ('<pad>', '<unk>', '<bos>', '<eos>')] == [0, 1, 2, 3],
            'special token IDs do not match the supported tokenizer contract')

    config = ModelConfig.from_dict(config_data)
    require(config.vocab_size == tokenizer.vocab_size, 'config/tokenizer vocabulary size mismatch')
    require(config.context_length > 1, 'context_length must be greater than one')
    require(config.embedding_dimension > 0, 'embedding_dimension must be positive')
    require(config.number_of_layers > 0, 'number_of_layers must be positive')
    require(config.attention_heads > 0 and config.embedding_dimension % config.attention_heads == 0,
            'embedding_dimension must be divisible by attention_heads')
    require(config.feed_forward_dimension > 0, 'feed_forward_dimension must be positive')
    require(config.weight_tying is True, 'unsupported architecture: weight tying must be enabled')
    require(config.normalization == 'LayerNorm-pre-norm', 'unsupported normalization configuration')
    require(config.positional_encoding == 'learned-absolute', 'unsupported positional encoding')
    require(config.tokenizer_version == 'astratokenizer-v0.1', 'unsupported tokenizer version')

    hashes = {name: sha256_file(root / name) for name in required_files}
    require(config.tokenizer_sha256 == hashes['tokenizer.json'],
            'config tokenizer SHA-256 does not match tokenizer.json')
    require(training.get('status') == 'trained', 'training state is not marked trained')
    require(training.get('checkpoint_selection') == 'lowest_validation_loss',
            'checkpoint was not selected by lowest validation loss')
    require(evaluation.get('checkpoint_selection') == 'lowest_validation_loss',
            'test report does not identify best-validation checkpoint selection')

    epoch = checkpoint.get('epoch')
    step = checkpoint.get('step')
    require(isinstance(epoch, int) and epoch > 0, 'checkpoint epoch is invalid')
    require(isinstance(step, int) and step > 0, 'checkpoint step is invalid')
    require(epoch == training.get('epoch') == evaluation.get('checkpoint_epoch'),
            'checkpoint epoch mismatch across artifacts')
    require(step == training.get('step') == evaluation.get('checkpoint_step'),
            'checkpoint step mismatch across artifacts')
    require(training.get('test_evaluated_checkpoint_epoch') == epoch,
            'test metrics were not recorded against the saved checkpoint epoch')
    require(training.get('test_evaluated_checkpoint_step') == step,
            'test metrics were not recorded against the saved checkpoint step')

    for field in ('validation_loss', 'validation_perplexity', 'test_loss', 'test_perplexity'):
        finite_nonnegative(training.get(field), f'training_state.{field}')
        finite_nonnegative(evaluation.get(field), f'test_evaluation.{field}')
    require(math.isclose(training['validation_loss'], evaluation['validation_loss'],
                         rel_tol=1e-7, abs_tol=1e-8),
            'validation loss mismatch across reports')
    require(math.isclose(training['test_loss'], evaluation['test_loss'],
                         rel_tol=1e-7, abs_tol=1e-8),
            'test loss mismatch across reports')

    dataset_splits, dataset_metadata = read_dataset(corpus_dir)
    require(dataset_metadata.get('format') == 'jsonl',
            'certification requires a licensed records.jsonl dataset')
    require(dataset_metadata == training.get('dataset'),
            'current dataset provenance does not match training metadata')
    require(dataset_metadata == evaluation.get('dataset'),
            'dataset provenance differs between training and test reports')
    require(all(dataset_splits.values()), 'train, validation and test splits must all be non-empty')

    model_state = checkpoint.get('model')
    require(isinstance(model_state, dict) and model_state, 'checkpoint model state is missing')
    require(all(torch.is_tensor(value) and torch.isfinite(value).all().item()
                for value in model_state.values()),
            'checkpoint contains non-tensor or non-finite model parameters')

    model = AstraCoreLM(config)
    model.load_state_dict(model_state, strict=True)
    require(torch.equal(model.token.weight, model.lm_head.weight),
            'input embedding and output head weights are not tied')
    model.eval()
    prompt_ids = tokenizer.encode_for_context(
        'AstraCore checkpoint certification smoke test',
        max_raw_tokens=16,
        max_encoded_tokens=config.context_length,
    )
    with torch.no_grad():
        logits, _ = model(torch.tensor([prompt_ids], dtype=torch.long))
        next_id = model.next_token(torch.tensor([prompt_ids], dtype=torch.long))
    require(torch.isfinite(logits).all().item(), 'model forward pass produced non-finite logits')
    require(0 <= next_id < tokenizer.vocab_size, 'next-token smoke test returned invalid token ID')

    report = {
        'status': 'EXPERIMENTAL_CHECKPOINT_VERIFIED',
        'production_approved': False,
        'certification_version': 'astracore-checkpoint-cert-v1',
        'checkpoint_epoch': epoch,
        'checkpoint_step': step,
        'metrics': {
            'validation_loss': evaluation['validation_loss'],
            'validation_perplexity': evaluation['validation_perplexity'],
            'test_loss': evaluation['test_loss'],
            'test_perplexity': evaluation['test_perplexity'],
        },
        'dataset': dataset_metadata,
        'sha256': hashes,
        'checks_passed': [
            'required_artifacts_present',
            'tokenizer_vocabulary_and_special_tokens_valid',
            'model_config_compatible',
            'tokenizer_digest_matches_config',
            'checkpoint_and_reports_match',
            'licensed_dataset_provenance_matches',
            'checkpoint_weights_finite_and_load_strictly',
            'tied_embeddings_verified',
            'finite_forward_pass',
            'next_token_id_in_range',
        ],
        'limitations': [
            'This is an integrity and runtime smoke test, not a quality benchmark.',
            'No claim of general reasoning, factuality, safety, or GPT-class capability.',
            'Human review, independent behavioral evaluation, security review, and deployment approval remain required.',
        ],
    }
    return report


def main():
    parser = argparse.ArgumentParser(description='Verify AstraCore experimental checkpoint integrity.')
    parser.add_argument('--checkpoint', required=True, help='Directory containing checkpoint artifacts')
    parser.add_argument('--corpus', required=True, help='Original licensed dataset directory')
    parser.add_argument('--report', default=None, help='Optional output JSON report path')
    args = parser.parse_args()

    try:
        report = certify(args.checkpoint, args.corpus)
        exit_code = 0
    except Exception as exc:
        report = {
            'status': 'CHECKPOINT_REJECTED',
            'production_approved': False,
            'error_type': type(exc).__name__,
            'reason': str(exc),
            'checks_passed': [],
        }
        exit_code = 1

    rendered = json.dumps(report, indent=2, ensure_ascii=False)
    print(rendered)
    if args.report:
        report_path = Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(rendered + '\\n', encoding='utf-8')
    raise SystemExit(exit_code)


if __name__ == '__main__':
    main()

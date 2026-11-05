"""Secure local serving contract for AstraCoreLM v0.2.

The experimental mode is loopback-only. Production serving requires a separate
approval manifest bound to the exact checkpoint, tokenizer and evaluation hashes.
"""
import hashlib
import hmac
import json
from pathlib import Path
import time

import torch

from model.config_v02 import ModelConfigV02
from model.model_v02 import AstraCoreLMV02
from model.tokenizer import AstraTokenizer


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def is_loopback_host(host):
    return host in ('127.0.0.1', '::1', 'localhost')


def load_approved_runtime(checkpoint_dir, approval_file=None, allow_experimental=False, bind_host='127.0.0.1'):
    root = Path(checkpoint_dir).resolve()
    required = [root / 'checkpoint.pt', root / 'tokenizer.json', root / 'model-config.json', root / 'behavioral_evaluation.json']
    if not all(path.is_file() for path in required):
        raise RuntimeError('INCOMPLETE_CHECKPOINT_ARTIFACTS')
    checkpoint_path, tokenizer_path, config_path, evaluation_path = required
    checkpoint_sha = sha256_file(checkpoint_path)
    tokenizer_sha = sha256_file(tokenizer_path)
    config_sha = sha256_file(config_path)
    evaluation_sha = sha256_file(evaluation_path)

    config = ModelConfigV02.from_dict(json.loads(config_path.read_text(encoding='utf-8')))
    tokenizer = AstraTokenizer.load(tokenizer_path)
    if tokenizer_sha != config.tokenizer_sha256:
        raise RuntimeError('TOKENIZER_SHA_MISMATCH')
    payload = torch.load(checkpoint_path, map_location='cpu', weights_only=True)
    if payload.get('tokenizer_sha256') != tokenizer_sha:
        raise RuntimeError('CHECKPOINT_TOKENIZER_SHA_MISMATCH')
    if payload.get('config_sha256') != config_sha:
        raise RuntimeError('CHECKPOINT_CONFIG_SHA_MISMATCH')
    if payload.get('model_version') != 'astracorelm-v0.2':
        raise RuntimeError('MODEL_VERSION_MISMATCH')

    evaluation = json.loads(evaluation_path.read_text(encoding='utf-8'))
    if evaluation.get('checkpoint_sha256') != checkpoint_sha or evaluation.get('tokenizer_sha256') != tokenizer_sha:
        raise RuntimeError('EVALUATION_ARTIFACT_HASH_MISMATCH')
    if evaluation.get('production_approved') is not False:
        raise RuntimeError('INVALID_EVALUATION_APPROVAL_STATE')

    production_approved = False
    if approval_file:
        approval = json.loads(Path(approval_file).read_text(encoding='utf-8'))
        required_approval = {
            'production_approved': True,
            'checkpoint_sha256': checkpoint_sha,
            'tokenizer_sha256': tokenizer_sha,
            'evaluation_sha256': evaluation_sha,
        }
        for key, expected in required_approval.items():
            if approval.get(key) != expected:
                raise RuntimeError('PRODUCTION_APPROVAL_MISMATCH:' + key)
        if not str(approval.get('approved_by', '')).strip() or not str(approval.get('approved_at', '')).strip():
            raise RuntimeError('PRODUCTION_APPROVAL_AUDIT_FIELDS_MISSING')
        production_approved = True
    elif allow_experimental:
        if not is_loopback_host(bind_host):
            raise RuntimeError('EXPERIMENTAL_MODEL_MUST_BIND_LOOPBACK')
    else:
        raise RuntimeError('PRODUCTION_APPROVAL_REQUIRED')

    model = AstraCoreLMV02(config)
    model.load_state_dict(payload['model'], strict=True)
    model.eval()
    return {
        'model': model,
        'tokenizer': tokenizer,
        'config': config,
        'checkpoint_sha256': checkpoint_sha,
        'tokenizer_sha256': tokenizer_sha,
        'evaluation_sha256': evaluation_sha,
        'model_version': 'astracorelm-v0.2',
        'production_approved': production_approved,
    }


def generate_response(runtime, prompt, max_new_tokens=48):
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError('PROMPT_REQUIRED')
    if len(prompt) > 12000:
        raise ValueError('PROMPT_TOO_LARGE')
    if isinstance(max_new_tokens, bool) or not isinstance(max_new_tokens, int) or not 1 <= max_new_tokens <= 64:
        raise ValueError('INVALID_MAX_NEW_TOKENS')
    cfg = runtime['config']
    tok = runtime['tokenizer']
    ids = tok.encode_for_context(prompt, cfg.max_raw_input_tokens, cfg.max_encoded_sequence_length)
    input_ids = torch.tensor([ids[:-1]], dtype=torch.long)
    started = time.perf_counter()
    with torch.inference_mode():
        output = runtime['model'].generate_greedy(input_ids, tok.eos_id, max_new_tokens=max_new_tokens)
    elapsed_ms = (time.perf_counter() - started) * 1000
    generated_ids = output[0].tolist()[input_ids.shape[1]:]
    return {
        'text': tok.decode(generated_ids),
        'tokens_generated': len(generated_ids),
        'latency_ms': round(elapsed_ms, 3),
        'model_version': runtime['model_version'],
        'checkpoint_sha256': runtime['checkpoint_sha256'],
        'production_approved': runtime['production_approved'],
    }


def authorize_request(provided_token, expected_token):
    if not isinstance(provided_token, str) or not isinstance(expected_token, str) or not expected_token:
        return False
    return hmac.compare_digest(provided_token.encode('utf-8'), expected_token.encode('utf-8'))

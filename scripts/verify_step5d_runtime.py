import argparse
import hashlib
import json
import platform
import time
from pathlib import Path

import torch

from model.config_v02 import ModelConfigV02
from model.model_v02 import AstraCoreLMV02
from model.tokenizer import AstraTokenizer


def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--checkpoint-dir', required=True)
    p.add_argument('--output', required=True)
    a = p.parse_args()
    ck = Path(a.checkpoint_dir)
    load_start = time.perf_counter()
    cfg = ModelConfigV02.from_dict(json.loads((ck / 'model-config.json').read_text()))
    tok = AstraTokenizer.load(ck / 'tokenizer.json')
    payload = torch.load(ck / 'checkpoint.pt', map_location='cpu', weights_only=False)
    model = AstraCoreLMV02(cfg)
    model.load_state_dict(payload['model'], strict=True)
    model.eval()
    model_load_latency_ms = (time.perf_counter() - load_start) * 1000
    checkpoint_sha = sha(ck / 'checkpoint.pt')
    tokenizer_sha = sha(ck / 'tokenizer.json')
    config_sha = sha(ck / 'model-config.json')
    if payload.get('tokenizer_sha256') != tokenizer_sha: raise RuntimeError('CHECKPOINT_TOKENIZER_SHA_MISMATCH')
    if payload.get('config_sha256') != config_sha: raise RuntimeError('CHECKPOINT_CONFIG_SHA_MISMATCH')
    if payload.get('model_version') != 'astracorelm-v0.2': raise RuntimeError('MODEL_VERSION_MISMATCH')
    if cfg.architecture_version != 'astracorelm-arch-v0.2': raise RuntimeError('ARCHITECTURE_VERSION_MISMATCH')
    if cfg.tokenizer_version != 'astratokenizer-v0.1': raise RuntimeError('TOKENIZER_VERSION_MISMATCH')

    samples = {
        'short': 'hello',
        'normal': 'Explain secure software engineering in one sentence.',
        'near_limit': 'x ' * 126,
        'over_limit_127': 'x ' * 127,
        'over_limit_128': 'x ' * 128,
    }
    context_results = {}
    for name, text in samples.items():
        result = {'raw_tokens': len(tok.tokens(text))}
        try:
            ids = tok.encode_for_context(text, cfg.max_raw_input_tokens, cfg.max_encoded_sequence_length)
            result['encoded_tokens'] = len(ids)
            x = torch.tensor([ids[:-1]], dtype=torch.long)
            t0 = time.perf_counter(); y = model.generate_greedy(x, tok.eos_id, max_new_tokens=1); elapsed = (time.perf_counter() - t0) * 1000
            result.update({'status':'PASS','generation_latency_ms':elapsed,'generated_tokens':int(y.shape[1]-x.shape[1])})
        except ValueError as exc:
            result.update({'status':'REJECTED','error':str(exc)})
        context_results[name] = result
    assert context_results['near_limit']['status'] == 'PASS'
    assert context_results['over_limit_127']['status'] == 'REJECTED'
    assert context_results['over_limit_128']['status'] == 'REJECTED'

    ids = tok.encode_for_context('Explain authentication briefly.', cfg.max_raw_input_tokens, cfg.max_encoded_sequence_length)
    x = torch.tensor([ids[:-1]], dtype=torch.long)
    t0 = time.perf_counter(); y = model.generate_greedy(x, tok.eos_id, max_new_tokens=8); generation_ms = (time.perf_counter() - t0) * 1000
    generated = max(1, int(y.shape[1] - x.shape[1]))
    report = {
        'checkpoint_sha256': checkpoint_sha,
        'checkpoint_size_bytes': (ck/'checkpoint.pt').stat().st_size,
        'architecture_version': cfg.architecture_version,
        'tokenizer_version': cfg.tokenizer_version,
        'tokenizer_sha256': tokenizer_sha,
        'config_sha256': config_sha,
        'parameter_count': sum(p.numel() for p in model.parameters()),
        'reload_pass': True,
        'python_version': platform.python_version(),
        'pytorch_version': torch.__version__,
        'effective_context_limit': cfg.context_length,
        'special_token_overhead': cfg.special_token_overhead,
        'max_raw_input_tokens': cfg.max_raw_input_tokens,
        'max_encoded_sequence_length': cfg.max_encoded_sequence_length,
        'over_limit_behavior': context_results['over_limit_128']['status'],
        'context_results': context_results,
        'model_load_latency_ms': model_load_latency_ms,
        'tokenizer_load_ms': 'NOT_MEASURED',
        'first_token_latency_ms': generation_ms / generated,
        'generation_latency_ms': generation_ms,
        'tokens_per_second': generated / max(generation_ms / 1000.0, 1e-9),
        'peak_ram_mb': 'NOT_MEASURED',
        'production_approved': False,
    }
    Path(a.output).write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    main()

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


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--checkpoint-dir', required=True)
    p.add_argument('--output', required=True)
    a = p.parse_args()
    ck = Path(a.checkpoint_dir)
    cfg = ModelConfigV02.from_dict(json.loads((ck / 'model-config.json').read_text()))
    tok = AstraTokenizer.load(ck / 'tokenizer.json')
    payload = torch.load(ck / 'checkpoint.pt', map_location='cpu', weights_only=False)
    model = AstraCoreLMV02(cfg)
    model.load_state_dict(payload['model'], strict=True)
    model.eval()
    checkpoint_sha = sha(ck / 'checkpoint.pt')
    tokenizer_sha = sha(ck / 'tokenizer.json')
    config_sha = sha(ck / 'model-config.json')
    if payload.get('tokenizer_sha256') != tokenizer_sha:
        raise RuntimeError('CHECKPOINT_TOKENIZER_SHA_MISMATCH')
    if payload.get('config_sha256') != config_sha:
        raise RuntimeError('CHECKPOINT_CONFIG_SHA_MISMATCH')
    if payload.get('model_version') != 'astracorelm-v0.2':
        raise RuntimeError('MODEL_VERSION_MISMATCH')
    if cfg.architecture_version != 'astracorelm-arch-v0.2':
        raise RuntimeError('ARCHITECTURE_VERSION_MISMATCH')
    if cfg.tokenizer_version != 'astratokenizer-v0.1':
        raise RuntimeError('TOKENIZER_VERSION_MISMATCH')

    def encoded(text):
        return tok.encode(text, add_bos=True, add_eos=False)

    samples = {
        'short': 'hello',
        'normal': 'Explain secure software engineering in one sentence.',
        'near_limit': 'x ' * 120,
        'declared_128_tokens': 'x ' * 127,
        'over_limit': 'x ' * 128,
    }
    context_results = {}
    for name, text in samples.items():
        ids = encoded(text)
        result = {'encoded_tokens': len(ids)}
        try:
            x = torch.tensor([ids], dtype=torch.long)
            if x.shape[1] > cfg.context_length:
                raise ValueError('CONTEXT_LENGTH_EXCEEDED')
            t0 = time.perf_counter()
            y = model.generate_greedy(x, tok.eos_id, max_new_tokens=1)
            elapsed = (time.perf_counter() - t0) * 1000
            result.update({'status':'PASS','generation_latency_ms':elapsed,'generated_tokens':int(y.shape[1]-x.shape[1])})
        except ValueError as exc:
            result.update({'status':'REJECTED','error':str(exc)})
        context_results[name] = result

    x = torch.tensor([encoded('Explain authentication briefly.')], dtype=torch.long)
    load_start = time.perf_counter()
    # The model is already freshly constructed/reloaded above; this timing is retained
    # as a deterministic post-reload generation measurement rather than a claim about disk load.
    _ = model(x)
    load_proxy_ms = (time.perf_counter() - load_start) * 1000
    t0 = time.perf_counter()
    y = model.generate_greedy(x, tok.eos_id, max_new_tokens=8)
    generation_ms = (time.perf_counter() - t0) * 1000
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
        'over_limit_behavior': context_results['over_limit']['status'],
        'context_results': context_results,
        'model_load_latency_ms': 'NOT_MEASURED',
        'post_reload_inference_latency_ms': load_proxy_ms,
        'first_token_latency_ms': generation_ms / generated,
        'generation_latency_ms': generation_ms,
        'tokens_per_second': generated / max(generation_ms / 1000.0, 1e-9),
        'peak_memory_mb': 'NOT_MEASURED',
        'production_approved': False,
    }
    Path(a.output).write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

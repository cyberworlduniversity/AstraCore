import json
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

import pytest
import torch

from model.config_v02 import ModelConfigV02
from model.model_v02 import AstraCoreLMV02
from model.serving_v02 import authorize_request, generate_response, is_loopback_host, load_approved_runtime
from model.tokenizer import AstraTokenizer
from scripts.serve_lm_v02 import build_handler


def make_checkpoint(tmp_path):
    tok = AstraTokenizer.build(['hello world', 'secure software engineering', 'வணக்கம் தமிழ்'], 64)
    tok_path = tmp_path / 'tokenizer.json'
    tok.save(tok_path)
    import hashlib
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    cfg = ModelConfigV02(vocab_size=tok.vocab_size, context_length=16, embedding_dimension=16,
                         number_of_layers=1, attention_heads=2, feed_forward_dimension=32,
                         tokenizer_sha256=sha(tok_path), max_raw_input_tokens=14, max_encoded_sequence_length=16)
    config_path = tmp_path / 'model-config.json'
    config_path.write_text(json.dumps(cfg.to_dict()), encoding='utf-8')
    model = AstraCoreLMV02(cfg)
    checkpoint_path = tmp_path / 'checkpoint.pt'
    torch.save({'model': model.state_dict(), 'model_version': 'astracorelm-v0.2',
                'tokenizer_sha256': sha(tok_path), 'config_sha256': sha(config_path)}, checkpoint_path)
    import model.serving_v02 as serving
    evaluation = {'checkpoint_sha256': sha(checkpoint_path), 'tokenizer_sha256': sha(tok_path), 'production_approved': False}
    evaluation_path = tmp_path / 'behavioral_evaluation.json'
    evaluation_path.write_text(json.dumps(evaluation), encoding='utf-8')
    return tmp_path, sha, evaluation_path


def test_experimental_model_loads_only_on_loopback(tmp_path):
    root, _, _ = make_checkpoint(tmp_path)
    runtime = load_approved_runtime(root, allow_experimental=True, bind_host='127.0.0.1')
    assert runtime['production_approved'] is False
    with pytest.raises(RuntimeError, match='EXPERIMENTAL_MODEL_MUST_BIND_LOOPBACK'):
        load_approved_runtime(root, allow_experimental=True, bind_host='0.0.0.0')


def test_missing_approval_fails_closed(tmp_path):
    root, _, _ = make_checkpoint(tmp_path)
    with pytest.raises(RuntimeError, match='PRODUCTION_APPROVAL_REQUIRED'):
        load_approved_runtime(root)


def test_approval_must_match_exact_checkpoint_tokenizer_and_evaluation(tmp_path):
    root, sha, evaluation_path = make_checkpoint(tmp_path)
    approval = tmp_path / 'approval.json'
    approval.write_text(json.dumps({
        'production_approved': True,
        'checkpoint_sha256': sha(root / 'checkpoint.pt'),
        'tokenizer_sha256': sha(root / 'tokenizer.json'),
        'evaluation_sha256': sha(evaluation_path),
        'approved_by': 'independent-reviewer',
        'approved_at': '2026-11-05T00:00:00Z',
    }))
    runtime = load_approved_runtime(root, approval)
    assert runtime['production_approved'] is True
    approval.write_text(json.dumps({'production_approved': True, 'approved_by': 'reviewer', 'approved_at': 'now'}))
    with pytest.raises(RuntimeError, match='PRODUCTION_APPROVAL_MISMATCH'):
        load_approved_runtime(root, approval)


def test_inference_respects_prompt_and_token_limits(tmp_path):
    root, _, _ = make_checkpoint(tmp_path)
    runtime = load_approved_runtime(root, allow_experimental=True, bind_host='localhost')
    result = generate_response(runtime, 'hello', 3)
    assert result['model_version'] == 'astracorelm-v0.2'
    assert result['tokens_generated'] <= 3
    assert result['production_approved'] is False
    with pytest.raises(ValueError, match='PROMPT_REQUIRED'):
        generate_response(runtime, ' ')
    with pytest.raises(ValueError, match='INVALID_MAX_NEW_TOKENS'):
        generate_response(runtime, 'hello', 1000)


def test_bearer_token_comparison_is_fail_closed():
    token = 'a' * 40
    assert authorize_request(token, token)
    assert not authorize_request(token[:-1] + 'b', token)
    assert not authorize_request('', token)
    assert not authorize_request(token, '')



def test_http_health_and_generation_require_bearer_token():
    token = 'secure-test-token-' + ('x' * 32)
    runtime = {
        'model_version': 'astracorelm-v0.2',
        'checkpoint_sha256': 'a' * 64,
        'tokenizer_sha256': 'b' * 64,
        'production_approved': False,
    }
    server = ThreadingHTTPServer(('127.0.0.1', 0), build_handler(runtime, token))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        conn = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
        conn.request('GET', '/health')
        response = conn.getresponse()
        assert response.status == 401
        response.read()
        conn.request('GET', '/health', headers={'Authorization': 'Bearer ' + token})
        response = conn.getresponse()
        assert response.status == 200
        health = json.loads(response.read())
        assert health['model_version'] == 'astracorelm-v0.2'
        assert health['production_approved'] is False
        conn.request('POST', '/v1/generate', body='{}', headers={'Authorization': 'Bearer wrong-token', 'Content-Length': '2'})
        response = conn.getresponse()
        assert response.status == 401
        response.read()
        conn.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_loopback_host_validation():
    assert is_loopback_host('127.0.0.1')
    assert is_loopback_host('::1')
    assert is_loopback_host('localhost')
    assert not is_loopback_host('0.0.0.0')
    assert not is_loopback_host('192.0.2.1')

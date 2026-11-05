"""Run the AstraCoreLM v0.2 inference service.

Default bind is loopback. Experimental mode is permitted only on loopback.
Production mode requires an explicit approval manifest bound to exact artifact hashes.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import secrets

from model.serving_v02 import authorize_request, generate_response, load_approved_runtime, is_loopback_host

HOST = os.environ.get('ASTRACORE_LM_HOST', '127.0.0.1')
PORT = int(os.environ.get('ASTRACORE_LM_PORT', '8790'))
TOKEN = os.environ.get('ASTRACORE_LM_TOKEN', '')
CHECKPOINT = os.environ.get('ASTRACORE_LM_CHECKPOINT', '')
APPROVAL = os.environ.get('ASTRACORE_LM_APPROVAL_FILE', '')
ALLOW_EXPERIMENTAL = os.environ.get('ASTRACORE_LM_ALLOW_EXPERIMENTAL', '') == '1'
MAX_BODY = 16 * 1024


def build_handler(runtime, token):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'AstraCoreLM/0.2'
        sys_version = ''

        def log_message(self, _format, *args):
            return

        def send_json(self, status, payload):
            raw = json.dumps(payload, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            if self.path != '/health':
                return self.send_json(404, {'error': 'not_found'})
            supplied = self.headers.get('Authorization', '')
            if not supplied.startswith('Bearer ') or not authorize_request(supplied[7:], token):
                return self.send_json(401, {'error': 'unauthorized'})
            return self.send_json(200, {
                'ok': True,
                'model_version': runtime['model_version'],
                'checkpoint_sha256': runtime['checkpoint_sha256'],
                'tokenizer_sha256': runtime['tokenizer_sha256'],
                'production_approved': runtime['production_approved'],
                'runtime': 'pytorch-cpu',
            })

        def do_POST(self):
            if self.path != '/v1/generate':
                return self.send_json(404, {'error': 'not_found'})
            supplied = self.headers.get('Authorization', '')
            if not supplied.startswith('Bearer ') or not authorize_request(supplied[7:], token):
                return self.send_json(401, {'error': 'unauthorized'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                return self.send_json(400, {'error': 'invalid_content_length'})
            if length <= 0 or length > MAX_BODY:
                return self.send_json(413, {'error': 'request_size_invalid'})
            try:
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    return self.send_json(400, {'error': 'json_object_required'})
                result = generate_response(runtime, body.get('prompt'), body.get('max_new_tokens', 48))
            except (ValueError, TypeError, json.JSONDecodeError) as exc:
                return self.send_json(400, {'error': str(exc)[:120]})
            except Exception:
                return self.send_json(500, {'error': 'inference_failed'})
            return self.send_json(200, result)

    return Handler


def main():
    if not CHECKPOINT:
        raise SystemExit('ASTRACORE_LM_CHECKPOINT is required')
    if not TOKEN or len(TOKEN) < 32:
        raise SystemExit('ASTRACORE_LM_TOKEN must contain at least 32 characters')
    if not 1 <= PORT <= 65535:
        raise SystemExit('ASTRACORE_LM_PORT is invalid')
    if ALLOW_EXPERIMENTAL and not is_loopback_host(HOST):
        raise SystemExit('Experimental inference must bind to loopback only')
    runtime = load_approved_runtime(CHECKPOINT, APPROVAL or None, ALLOW_EXPERIMENTAL, HOST)
    server = ThreadingHTTPServer((HOST, PORT), build_handler(runtime, TOKEN))
    server.daemon_threads = True
    print(json.dumps({
        'event': 'astracore_lm_server_started',
        'host': HOST,
        'port': PORT,
        'model_version': runtime['model_version'],
        'checkpoint_sha256': runtime['checkpoint_sha256'],
        'production_approved': runtime['production_approved'],
    }))
    server.serve_forever()


if __name__ == '__main__':
    main()

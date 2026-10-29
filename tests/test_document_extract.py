import base64
import json
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'document_extract.py'

def run(payload):
    return subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps(payload), text=True, capture_output=True, check=False)

def test_text_extraction():
    data = base64.b64encode('AstraCore\nTamil: வணக்கம்\nPython: print(1)'.encode()).decode()
    result = run({'name': 'notes.txt', 'data': data})
    assert result.returncode == 0
    body = json.loads(result.stdout)
    assert body['ok'] is True
    assert 'வணக்கம்' in body['segments'][0]['text']

def test_unsupported_legacy_format():
    data = base64.b64encode(b'legacy').decode()
    result = run({'name': 'old.doc', 'data': data})
    assert result.returncode != 0
    body = json.loads(result.stdout)
    assert body['ok'] is False
    assert 'Unsupported' in body['error'] or 'NOT_IMPLEMENTED' in body['error']

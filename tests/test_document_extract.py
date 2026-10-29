import base64
import json
import subprocess
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'document_extract.py'

def run(payload):
    return subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps(payload), text=True, capture_output=True, check=False)

class DocumentExtractTests(unittest.TestCase):
    def test_text_extraction(self):
        data = base64.b64encode('AstraCore\nTamil: வணக்கம்\nPython: print(1)'.encode()).decode()
        result = run({'name': 'notes.txt', 'data': data})
        self.assertEqual(result.returncode, 0)
        body = json.loads(result.stdout)
        self.assertTrue(body['ok'])
        self.assertIn('வணக்கம்', body['segments'][0]['text'])

    def test_unsupported_legacy_format(self):
        data = base64.b64encode(b'legacy').decode()
        result = run({'name': 'old.doc', 'data': data})
        self.assertNotEqual(result.returncode, 0)
        body = json.loads(result.stdout)
        self.assertFalse(body['ok'])
        self.assertTrue('Unsupported' in body['error'] or 'NOT_IMPLEMENTED' in body['error'])

if __name__ == '__main__':
    unittest.main()

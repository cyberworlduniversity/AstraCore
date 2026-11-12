import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "data" / "download_hf_corpora.py"
SPEC = importlib.util.spec_from_file_location("download_hf_corpora", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DownloadCorpusTests(unittest.TestCase):
    def test_tamil_download_filters_license_and_quality(self):
        rows = [
            {"license": "CC-0", "quality_score": 0.95, "language_score": 0.99,
             "text": "தமிழ் மொழிக்கான தரமான உரை. " * 4},
            {"license": "CC-BY-SA-4.0", "quality_score": 0.99, "language_score": 0.99,
             "text": "இந்த உரை share alike license உடையது. " * 4},
            {"license": "public-domain", "quality_score": 0.4, "language_score": 0.99,
             "text": "தர மதிப்பெண் குறைந்த உரை. " * 4},
            {"license": "public-domain", "quality_score": 0.95, "language_score": 0.99,
             "text": "பொது உரிமத்தில் வெளியிடப்பட்ட தமிழ் உரை. " * 4},
        ]
        original = MODULE.load_stream
        MODULE.load_stream = lambda *args, **kwargs: iter(rows)
        try:
            with tempfile.TemporaryDirectory() as temp:
                output = Path(temp) / "tamil.txt"
                report = MODULE.collect_tamil(output, 10, 0.8)
                content = output.read_text(encoding="utf-8")
                self.assertEqual(report["rows_written"], 2)
                self.assertEqual(report["license_rejected"], 1)
                self.assertEqual(report["quality_rejected"], 1)
                self.assertNotIn("share alike", content)
                self.assertIn("தமிழ்", content)
        finally:
            MODULE.load_stream = original

    def test_english_download_writes_text(self):
        rows = [{"text": "A sufficiently long English benchmark sentence. " * 2},
                {"text": "short"}]
        original = MODULE.load_stream
        MODULE.load_stream = lambda *args, **kwargs: iter(rows)
        try:
            with tempfile.TemporaryDirectory() as temp:
                output = Path(temp) / "english.txt"
                report = MODULE.collect_english(output, 10)
                self.assertEqual(report["rows_written"], 1)
                self.assertIn("English benchmark", output.read_text(encoding="utf-8"))
        finally:
            MODULE.load_stream = original


if __name__ == "__main__":
    unittest.main()

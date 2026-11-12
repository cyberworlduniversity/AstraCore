import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "data" / "prepare_corpus.py"


class PrepareCorpusTests(unittest.TestCase):
    def test_prepare_manifest_hashes_and_dedup(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source.txt"
            source.write_text("தமிழ்\nEnglish\nதமிழ்\n  mixed   text  \n", encoding="utf-8")
            sources = root / "sources.json"
            sources.write_text(json.dumps([{
                "path": str(source), "name": "test source",
                "url": "https://example.org/data", "license": "CC0-1.0",
                "language": "mixed"
            }]), encoding="utf-8")
            output = root / "prepared"
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--sources", str(sources),
                 "--output-dir", str(output), "--eval-percent", "20",
                 "--max-lines-per-source", "100"],
                cwd=ROOT, capture_output=True, text=True, check=True
            )
            manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["sources"][0]["duplicates_skipped"], 1)
            self.assertEqual(len(manifest["train"]["sha256"]), 64)
            self.assertEqual(len(manifest["eval"]["sha256"]), 64)
            combined = ((output / "train.txt").read_text(encoding="utf-8")
                        + (output / "eval.txt").read_text(encoding="utf-8"))
            self.assertIn("mixed text", combined)
            self.assertIn("தமிழ்", combined)
            self.assertIn("English", combined)

    def test_rejects_noncommercial_license(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source.txt"
            source.write_text("some text\n", encoding="utf-8")
            sources = root / "sources.json"
            sources.write_text(json.dumps([{
                "path": str(source), "name": "restricted",
                "url": "https://example.org/data", "license": "CC-BY-NC-4.0",
                "language": "en"
            }]), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--sources", str(sources),
                 "--output-dir", str(root / "out")],
                cwd=ROOT, capture_output=True, text=True
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Unapproved license", result.stderr)


if __name__ == "__main__":
    unittest.main()

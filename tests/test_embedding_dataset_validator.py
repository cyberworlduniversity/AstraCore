import json
import tempfile
import unittest
from pathlib import Path

from scripts.validate_embedding_dataset import validate


FIXTURE = Path(__file__).parent / "fixtures" / "embedding_pairs.valid.jsonl"


class EmbeddingDatasetValidatorTests(unittest.TestCase):
    def test_valid_fixture(self):
        result = validate(FIXTURE)
        self.assertEqual(result["status"], "valid")
        self.assertEqual(result["pair_count"], 2)
        self.assertEqual(len(result["sha256"]), 64)

    def test_duplicate_pairs_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "duplicate.jsonl"
            path.write_text(
                '{"left":"same","right":"pair"}\n'
                '{"left":"same","right":"pair"}\n',
                encoding="utf-8",
            )
            result = validate(path)
            self.assertEqual(result["status"], "invalid")
            self.assertTrue(any("duplicate pair" in error for error in result["errors"]))

    def test_missing_fields_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "missing.jsonl"
            path.write_text('{"left":"only one side"}\n', encoding="utf-8")
            result = validate(path)
            self.assertEqual(result["status"], "invalid")
            self.assertTrue(result["errors"])


if __name__ == "__main__":
    unittest.main()

import tempfile
import unittest
from pathlib import Path

from astra_tokenizer import ByteBPETokenizer


class ByteBPETokenizerTests(unittest.TestCase):
    def test_round_trip_english(self):
        text = "AstraCore builds its own model."
        tokenizer = ByteBPETokenizer.train([text, text], vocab_size=300)
        self.assertEqual(tokenizer.decode(tokenizer.encode(text)), text)

    def test_round_trip_tamil(self):
        text = "வணக்கம்! நமது சொந்த AI மாதிரி."
        tokenizer = ByteBPETokenizer.train([text, text], vocab_size=320)
        self.assertEqual(tokenizer.decode(tokenizer.encode(text)), text)

    def test_round_trip_mixed_and_symbols(self):
        text = "ASTRA தமிழ் English 123 — 😀"
        tokenizer = ByteBPETokenizer.train([text], vocab_size=300)
        self.assertEqual(tokenizer.decode(tokenizer.encode(text)), text)

    def test_save_load(self):
        text = "தமிழ் English தமிழ் English"
        tokenizer = ByteBPETokenizer.train([text, text], vocab_size=300)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "tokenizer.json"
            tokenizer.save(path)
            loaded = ByteBPETokenizer.load(path)
            self.assertEqual(loaded.decode(loaded.encode(text)), text)
            self.assertEqual(loaded.vocab_size, tokenizer.vocab_size)

    def test_vocab_minimum(self):
        with self.assertRaises(ValueError):
            ByteBPETokenizer.train(["hello"], vocab_size=100)


if __name__ == "__main__":
    unittest.main()

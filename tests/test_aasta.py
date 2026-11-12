import tempfile
import unittest
from pathlib import Path

from astra_tokenizer.aasta import AASTATokenizer


class AASTATests(unittest.TestCase):
    def test_tamil_english_and_mixed_round_trip(self):
        samples = [
            "வணக்கம்! இது ASTRA CORE AI.",
            "Tamil மற்றும் English கலந்த உரை.",
            "AstraCore — AI 2026 😀",
            "தமிழ் எழுத்துகள்: க்ஷ, ஸ்ரீ, ழ.",
        ]
        tokenizer = AASTATokenizer.train(samples * 3, vocab_size=420,
                                          min_frequency=2, max_token_bytes=20)
        for sample in samples:
            self.assertEqual(tokenizer.decode(tokenizer.encode(sample)), sample)

    def test_context_diversity_is_memory_bounded(self):
        samples = [chr(0x1000 + i) + "ab" + chr(0x2000 + i)
                   for i in range(80)]
        tokenizer = AASTATokenizer.train(
            samples, vocab_size=257, min_frequency=2, max_token_bytes=2
        )
        index = tokenizer.tokens.index(b"ab")
        self.assertLessEqual(tokenizer.context_diversities[index], 64)

    def test_unknown_text_uses_byte_fallback(self):
        trained = AASTATokenizer.train(["hello hello"], vocab_size=300)
        unknown = "புதிய சொல் 🛰️"
        self.assertEqual(trained.decode(trained.encode(unknown)), unknown)

    def test_save_load(self):
        corpus = ["தமிழ் AI தமிழ்", "English AI English"] * 3
        tokenizer = AASTATokenizer.train(corpus, vocab_size=360)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "aasta.json"
            tokenizer.save(path)
            loaded = AASTATokenizer.load(path)
            text = "தமிழ் English AI"
            self.assertEqual(loaded.decode(loaded.encode(text)), text)
            self.assertEqual(loaded.vocab_size, tokenizer.vocab_size)

    def test_invalid_settings(self):
        with self.assertRaises(ValueError):
            AASTATokenizer.train(["hello"], vocab_size=200)
        with self.assertRaises(ValueError):
            AASTATokenizer.train(["hello"], max_token_bytes=1)

    def test_invalid_token_ids(self):
        tokenizer = AASTATokenizer.train(["hello hello"], vocab_size=300)
        with self.assertRaises(ValueError):
            tokenizer.decode([tokenizer.vocab_size + 10])


if __name__ == "__main__":
    unittest.main()

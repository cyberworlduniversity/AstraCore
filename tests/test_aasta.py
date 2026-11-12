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

    def test_multibyte_tamil_codepoint_is_a_single_learned_token(self):
        tokenizer = AASTATokenizer.train(
            ["க"] * 20, vocab_size=300, min_frequency=2, max_token_bytes=8
        )
        encoded = tokenizer.encode("க")
        self.assertEqual(len(encoded), 1)
        self.assertGreaterEqual(encoded[0], 256)
        self.assertEqual(tokenizer.decode(encoded), "க")

    def test_vocabulary_reserves_slots_for_multibyte_codepoints(self):
        tamil_characters = "அஆஇஈஉஊஎஏஐஒஓஔகஙசஞடணதநபமயரலவழளறன"
        corpus = [
            tamil_characters * 8,
            "Long English phrases should not consume every learned token slot " * 5,
        ] * 20
        tokenizer = AASTATokenizer.train(
            corpus, vocab_size=300, min_frequency=2, max_token_bytes=24
        )
        learned_single_codepoints = sum(
            len(token.decode("utf-8")) == 1 for token in tokenizer.tokens
        )
        self.assertGreaterEqual(learned_single_codepoints, 22)

    def test_frequent_tamil_span_survives_candidate_pressure(self):
        corpus = ["தமிழ் அறிவியல் தமிழ் மொழி " * 4 for _ in range(80)]
        corpus.extend(f"unique-noise-{i:06d}-xyz" for i in range(1800))
        tokenizer = AASTATokenizer.train(
            corpus, vocab_size=420, min_frequency=2, max_token_bytes=16
        )
        self.assertIn("தமிழ்".encode("utf-8"), tokenizer.tokens)
        sample = "தமிழ் அறிவியல்"
        self.assertEqual(tokenizer.decode(tokenizer.encode(sample)), sample)

    def test_space_saving_candidate_selection_is_deterministic(self):
        corpus = ["தமிழ் தமிழ் English English"] * 20
        corpus.extend(f"noise-{i:05d}" for i in range(1500))
        first = AASTATokenizer.train(
            corpus, vocab_size=380, min_frequency=2, max_token_bytes=12
        )
        second = AASTATokenizer.train(
            corpus, vocab_size=380, min_frequency=2, max_token_bytes=12
        )
        self.assertEqual(first.to_dict(), second.to_dict())

    def test_candidate_statistics_have_a_hard_memory_cap(self):
        samples = [f"unique-{i:05d}-தமிழ்-context-{i:05d}" for i in range(1200)]
        tokenizer = AASTATokenizer.train(
            samples, vocab_size=320, min_frequency=1, max_token_bytes=16
        )
        self.assertLessEqual(
            tokenizer.training_candidate_count, tokenizer.training_candidate_cap
        )
        self.assertEqual(
            tokenizer.training_candidate_cap,
            max(AASTATokenizer.MIN_CANDIDATE_CAP,
                (320 - 256) * AASTATokenizer.MAX_CANDIDATE_MULTIPLIER),
        )

    def test_unicode_edge_cases_round_trip_without_normalization(self):
        samples = [
            "கொங்கு தமிழ் — வணக்கம்",
            "தமிழ்\u0bcd + combining marks",
            "e\u0301 and é must remain distinct",
            "👩‍💻 🏳️‍🌈 🇮🇳",
            "English 123 !?.,;:()[]{}",
            "தமிழ்-English_混合",
        ]
        tokenizer = AASTATokenizer.train(
            samples * 2, vocab_size=420, min_frequency=2, max_token_bytes=20
        )
        for sample in samples:
            self.assertEqual(tokenizer.decode(tokenizer.encode(sample)), sample)
        self.assertEqual(tokenizer.encode(""), [])

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

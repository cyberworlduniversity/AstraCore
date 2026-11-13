import tempfile
import unittest
import unicodedata
from pathlib import Path
from unittest.mock import patch

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
        self.assertGreaterEqual(learned_single_codepoints, (300 - 256) // 4)

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


    def test_vocabulary_balances_tamil_and_latin_spans(self):
        tamil = "தமிழ் மொழி அறிவியல் கணினி பாதுகாப்பு"
        english = "cyber security research computer science language model"
        corpus = [tamil] * 80 + [english] * 80
        tokenizer = AASTATokenizer.train(
            corpus, vocab_size=320, min_frequency=2, max_token_bytes=20
        )
        latin_tokens = [
            token for token in tokenizer.tokens
            if token.decode("utf-8").isascii()
            and any(char.isalpha() for char in token.decode("utf-8"))
        ]
        tamil_tokens = [
            token for token in tokenizer.tokens
            if any("TAMIL" in unicodedata.name(char, "")
                   for char in token.decode("utf-8"))
        ]
        self.assertGreater(len(latin_tokens), 0)
        self.assertGreater(len(tamil_tokens), 0)
        english_sample = "cyber security computer science"
        tamil_sample = "தமிழ் மொழி அறிவியல்"
        self.assertLess(
            len(tokenizer.encode(english_sample)),
            len(english_sample.encode("utf-8")),
        )
        self.assertLess(
            len(tokenizer.encode(tamil_sample)),
            len(tamil_sample.encode("utf-8")),
        )


    def test_space_saving_heap_ignores_stale_candidate_versions(self):
        corpus = [
            "தமிழ் தமிழ் தமிழ்",
            "alpha beta gamma delta epsilon",
            "தமிழ் தமிழ் தமிழ்",
            "alpha beta gamma delta epsilon",
        ] * 8
        with patch.object(AASTATokenizer, "MIN_CANDIDATE_CAP", 3), patch.object(
            AASTATokenizer, "MAX_CANDIDATE_MULTIPLIER", 0
        ):
            first = AASTATokenizer.train(
                corpus, vocab_size=260, min_frequency=1, max_token_bytes=8
            )
            second = AASTATokenizer.train(
                corpus, vocab_size=260, min_frequency=1, max_token_bytes=8
            )
        self.assertEqual(first.to_dict(), second.to_dict())
        self.assertEqual(first.training_candidate_cap, 3)
        self.assertLessEqual(first.training_candidate_count, 3)
        sample = "தமிழ் alpha"
        self.assertEqual(first.decode(first.encode(sample)), sample)


    def test_word_boundary_detection_uses_whitespace_and_punctuation(self):
        self.assertTrue(AASTATokenizer._is_boundary(" "))
        self.assertTrue(AASTATokenizer._is_boundary("."))
        self.assertTrue(AASTATokenizer._is_boundary("^"))
        self.assertTrue(AASTATokenizer._is_boundary("$"))
        self.assertFalse(AASTATokenizer._is_boundary("a"))
        self.assertFalse(AASTATokenizer._is_boundary("க"))
        self.assertFalse(AASTATokenizer._is_boundary("\u0bcd"))

    def test_boundary_aligned_phrase_is_learned_as_one_token(self):
        corpus = ["alpha beta"] * 40
        tokenizer = AASTATokenizer.train(
            corpus, vocab_size=257, min_frequency=2, max_token_bytes=20
        )
        phrase = "alpha beta"
        self.assertIn(phrase.encode("utf-8"), tokenizer.tokens)
        self.assertEqual(tokenizer.decode(tokenizer.encode(phrase)), phrase)

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

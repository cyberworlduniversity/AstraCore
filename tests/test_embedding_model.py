import unittest

import torch

from model.embedding_config import EmbeddingConfig
from model.embedding_model import AstraCoreEmbed
from model.embedding_tokenizer import EmbedTokenizer


class EmbeddingModelTests(unittest.TestCase):
    def test_tokenizer_is_deterministic(self):
        tokenizer = EmbedTokenizer().fit(["Python cybersecurity network security"])
        self.assertEqual(tokenizer.encode("Python security"), tokenizer.encode("Python security"))

    def test_model_returns_384_dimensions_and_unit_norm(self):
        tokenizer = EmbedTokenizer().fit(["Python security", "network security"])
        config = EmbeddingConfig(vocab_size=len(tokenizer.vocab))
        model = AstraCoreEmbed(config).eval()
        ids = torch.tensor([tokenizer.encode("Python security")])
        mask = ids.ne(0)
        vector = model(ids, mask)
        self.assertEqual(tuple(vector.shape), (1, 384))
        self.assertAlmostEqual(float(vector.norm(dim=-1)[0]), 1.0, places=5)

    def test_service_must_not_claim_untrained_model_is_ready(self):
        from model.embedding_service import EmbeddingService
        self.assertFalse(EmbeddingService().ready)
        with self.assertRaises(RuntimeError):
            EmbeddingService().embed("test")


if __name__ == "__main__":
    unittest.main()

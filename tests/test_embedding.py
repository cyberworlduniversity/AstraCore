import json
import tempfile
import unittest

import torch

from model.embedding_config import EmbeddingConfig
from model.embedding_dataset import Pair, split_pairs
from model.embedding_model import AstraCoreEmbed
from model.embedding_tokenizer import EmbedTokenizer


class EmbeddingTests(unittest.TestCase):
    def test_tokenizer_is_deterministic_and_serializable(self):
        tokenizer = EmbedTokenizer().fit(["AstraCore security", "AstraCore search"])
        payload = tokenizer.to_dict()
        restored = EmbedTokenizer.from_dict(payload)
        self.assertEqual(tokenizer.vocab, restored.vocab)
        self.assertEqual(tokenizer.encode("AstraCore security"), restored.encode("AstraCore security"))

    def test_model_returns_normalized_384_vectors(self):
        config = EmbeddingConfig(vocab_size=32)
        model = AstraCoreEmbed(config)
        ids = torch.tensor([[2, 3, 4], [5, 6, 0]], dtype=torch.long)
        mask = torch.tensor([[1, 1, 1], [1, 1, 0]], dtype=torch.bool)
        vectors = model(ids, mask)
        self.assertEqual(tuple(vectors.shape), (2, 384))
        norms = torch.linalg.vector_norm(vectors, dim=1)
        self.assertTrue(torch.allclose(norms, torch.ones(2), atol=1e-5))

    def test_split_is_reproducible(self):
        pairs = [Pair(f"q{i}", f"p{i}") for i in range(10)]
        first = split_pairs(pairs, validation_ratio=0.2, seed=42)
        second = split_pairs(pairs, validation_ratio=0.2, seed=42)
        self.assertEqual(first, second)
        self.assertEqual(len(first[1]), 2)


if __name__ == "__main__":
    unittest.main()

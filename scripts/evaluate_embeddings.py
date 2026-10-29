import argparse
import json

import torch

from model.embedding_checkpoint import EmbeddingCheckpoint
from model.embedding_dataset import load_pairs, split_pairs


def evaluate(checkpoint, pairs, device="cpu"):
    if not pairs:
        return {"pairs": 0, "mean_positive_cosine": None, "top1_accuracy": None}
    left = [pair.left for pair in pairs]
    right = [pair.right for pair in pairs]
    left_vec = checkpoint.encode(left, device=device)
    right_vec = checkpoint.encode(right, device=device)
    similarity = left_vec @ right_vec.T
    positive = similarity.diag()
    top1 = similarity.argmax(dim=1)
    accuracy = float((top1 == torch.arange(len(pairs), device=similarity.device)).float().mean())
    return {
        "pairs": len(pairs),
        "mean_positive_cosine": float(positive.mean()),
        "top1_accuracy": accuracy,
    }


def main():
    parser = argparse.ArgumentParser(description="Evaluate a trained AstraCoreEmbed checkpoint.")
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--data", required=True)
    parser.add_argument("--validation-ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    checkpoint = EmbeddingCheckpoint.load(args.checkpoint)
    pairs = load_pairs(args.data)
    _, validation = split_pairs(pairs, validation_ratio=args.validation_ratio, seed=args.seed)
    result = evaluate(checkpoint, validation)
    result["checkpoint"] = args.checkpoint
    result["embedding_dim"] = checkpoint.config.embedding_dim
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

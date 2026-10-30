import argparse
import json

import torch

from model.embedding_checkpoint import EmbeddingCheckpoint
from model.embedding_dataset import load_pairs, split_pairs


def evaluate(checkpoint, pairs, device='cpu'):
    if not pairs:
        return {'pairs': 0, 'mean_positive_cosine': None, 'top1_accuracy': None, 'recall_at_1': None, 'recall_at_5': None, 'recall_at_10': None, 'mrr': None}
    left = [pair.left for pair in pairs]
    right = [pair.right for pair in pairs]
    left_vec = checkpoint.encode(left, device=device)
    right_vec = checkpoint.encode(right, device=device)
    similarity = left_vec @ right_vec.T
    positive = similarity.diag()
    rankings = similarity.argsort(dim=1, descending=True)
    targets = torch.arange(len(pairs), device=similarity.device).unsqueeze(1)
    positions = (rankings == targets).nonzero(as_tuple=False)[:, 1] + 1
    return {
        'pairs': len(pairs),
        'mean_positive_cosine': float(positive.mean()),
        'top1_accuracy': float((positions == 1).float().mean()),
        'recall_at_1': float((positions <= 1).float().mean()),
        'recall_at_5': float((positions <= min(5, len(pairs))).float().mean()),
        'recall_at_10': float((positions <= min(10, len(pairs))).float().mean()),
        'mrr': float((1.0 / positions.float()).mean()),
    }


def main():
    parser = argparse.ArgumentParser(description='Evaluate a trained AstraCoreEmbed checkpoint.')
    parser.add_argument('--checkpoint', required=True)
    parser.add_argument('--data', required=True)
    parser.add_argument('--validation-ratio', type=float, default=0.1)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()
    checkpoint = EmbeddingCheckpoint.load(args.checkpoint)
    pairs = load_pairs(args.data)
    _, validation = split_pairs(pairs, validation_ratio=args.validation_ratio, seed=args.seed)
    result = evaluate(checkpoint, validation)
    result['checkpoint'] = args.checkpoint
    result['embedding_dim'] = checkpoint.config.embedding_dim
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()

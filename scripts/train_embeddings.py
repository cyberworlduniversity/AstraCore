import argparse
import hashlib
import json
import os
import random

import torch
from torch.utils.data import DataLoader

from model.embedding_config import EmbeddingConfig
from model.embedding_dataset import load_pairs, split_pairs
from model.embedding_model import AstraCoreEmbed
from model.embedding_tokenizer import EmbedTokenizer


def encode_batch(tokenizer, texts, max_length):
    ids = [tokenizer.encode(text, max_length=max_length) for text in texts]
    width = max(1, min(max(len(row) for row in ids), max_length))
    tensor = torch.zeros((len(ids), width), dtype=torch.long)
    mask = torch.zeros((len(ids), width), dtype=torch.bool)
    for i, row in enumerate(ids):
        row = row[:width]
        if row:
            tensor[i, :len(row)] = torch.tensor(row)
            mask[i, :len(row)] = True
    return tensor, mask


def dataset_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description="Train AstraCoreEmbed v0.1 locally.")
    parser.add_argument("--data", required=True, help="JSONL semantic pairs dataset")
    parser.add_argument("--output", default="checkpoints/astracore-embed-v0.1")
    parser.add_argument("--dataset-name", default="astracore-embed-training")
    parser.add_argument("--dataset-version", default="0.1.0")
    parser.add_argument("--source", default="user_provided")
    parser.add_argument("--license", default="")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)

    pairs = load_pairs(args.data)
    train_pairs, val_pairs = split_pairs(pairs, seed=args.seed)
    tokenizer = EmbedTokenizer().fit([p.left for p in pairs] + [p.right for p in pairs])
    config = EmbeddingConfig(vocab_size=max(2, len(tokenizer.vocab)))
    model = AstraCoreEmbed(config)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr)

    def batches(items):
        loader = DataLoader(items, batch_size=args.batch_size, shuffle=True, collate_fn=lambda x: x)
        for batch in loader:
            yield batch

    best = float("inf")
    for epoch in range(1, args.epochs + 1):
        model.train()
        total = 0.0
        count = 0
        for batch in batches(train_pairs):
            left, lm = encode_batch(tokenizer, [p.left for p in batch], config.max_length)
            right, rm = encode_batch(tokenizer, [p.right for p in batch], config.max_length)
            optimizer.zero_grad(set_to_none=True)
            loss = model.contrastive_loss(model(left, lm), model(right, rm))
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total += float(loss.detach())
            count += 1
        train_loss = total / max(1, count)

        model.eval()
        with torch.no_grad():
            vals = []
            for batch in batches(val_pairs):
                left, lm = encode_batch(tokenizer, [p.left for p in batch], config.max_length)
                right, rm = encode_batch(tokenizer, [p.right for p in batch], config.max_length)
                vals.append(float(model.contrastive_loss(model(left, lm), model(right, rm))))
        val_loss = sum(vals) / max(1, len(vals)) if vals else train_loss
        print(json.dumps({"epoch": epoch, "train_loss": train_loss, "val_loss": val_loss}))
        if val_loss < best:
            best = val_loss
            os.makedirs(args.output, exist_ok=True)
            torch.save(model.state_dict(), os.path.join(args.output, "model.pt"))
            with open(os.path.join(args.output, "config.json"), "w", encoding="utf-8") as handle:
                json.dump(config.to_dict(), handle, indent=2)
            with open(os.path.join(args.output, "tokenizer.json"), "w", encoding="utf-8") as handle:
                json.dump(tokenizer.to_dict(), handle, ensure_ascii=False, indent=2)
            with open(os.path.join(args.output, "training_state.json"), "w", encoding="utf-8") as handle:
                json.dump({"status": "trained", "epoch": epoch, "best_val_loss": best, "seed": args.seed}, handle, indent=2)
            with open(os.path.join(args.output, "dataset_manifest.json"), "w", encoding="utf-8") as handle:
                json.dump({
                    "dataset_name": args.dataset_name,
                    "dataset_version": args.dataset_version,
                    "format": "jsonl_semantic_pairs",
                    "source_type": args.source,
                    "license": args.license,
                    "content_sha256": dataset_sha256(args.data),
                    "pair_count": len(pairs),
                    "train_pair_count": len(train_pairs),
                    "validation_pair_count": len(val_pairs),
                    "seed": args.seed,
                    "model": "AstraCoreEmbed v0.1",
                }, handle, indent=2)


if __name__ == "__main__":
    main()

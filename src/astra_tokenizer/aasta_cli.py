"""Command-line interface for training and using AASTA."""
from __future__ import annotations

import argparse
from pathlib import Path

from .aasta import AASTATokenizer


def main() -> None:
    parser = argparse.ArgumentParser(prog="aasta")
    commands = parser.add_subparsers(dest="command", required=True)

    train = commands.add_parser("train", help="Train AASTA from UTF-8 text files")
    train.add_argument("--input", nargs="+", required=True)
    train.add_argument("--output", required=True)
    train.add_argument("--vocab-size", type=int, default=2048)
    train.add_argument("--min-frequency", type=int, default=2)
    train.add_argument("--max-token-bytes", type=int, default=16)
    train.add_argument("--context-weight", type=float, default=0.25)

    encode = commands.add_parser("encode", help="Encode text with AASTA")
    encode.add_argument("--tokenizer", required=True)
    encode.add_argument("--text", required=True)

    decode = commands.add_parser("decode", help="Decode AASTA token IDs")
    decode.add_argument("--tokenizer", required=True)
    decode.add_argument("--ids", required=True)

    args = parser.parse_args()
    if args.command == "train":
        corpus = [Path(name).read_text(encoding="utf-8") for name in args.input]
        tokenizer = AASTATokenizer.train(
            corpus, vocab_size=args.vocab_size,
            min_frequency=args.min_frequency,
            max_token_bytes=args.max_token_bytes,
            context_weight=args.context_weight,
        )
        tokenizer.save(args.output)
        print(f"Saved AASTA tokenizer: {args.output}")
        print(f"Vocabulary size: {tokenizer.vocab_size}")
    elif args.command == "encode":
        tokenizer = AASTATokenizer.load(args.tokenizer)
        print(",".join(map(str, tokenizer.encode(args.text))))
    else:
        tokenizer = AASTATokenizer.load(args.tokenizer)
        ids = [int(value.strip()) for value in args.ids.split(",") if value.strip()]
        print(tokenizer.decode(ids))


if __name__ == "__main__":
    main()

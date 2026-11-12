"""Command-line interface for AstraCore's tokenizer."""
from __future__ import annotations

import argparse
from pathlib import Path

from .tokenizer import ByteBPETokenizer


def main() -> None:
    parser = argparse.ArgumentParser(prog="astra-tokenizer")
    commands = parser.add_subparsers(dest="command", required=True)

    train = commands.add_parser("train", help="Train BPE merges from UTF-8 text files")
    train.add_argument("--input", nargs="+", required=True)
    train.add_argument("--output", required=True)
    train.add_argument("--vocab-size", type=int, default=512)
    train.add_argument("--min-frequency", type=int, default=2)

    encode = commands.add_parser("encode", help="Encode text")
    encode.add_argument("--tokenizer", required=True)
    encode.add_argument("--text", required=True)

    decode = commands.add_parser("decode", help="Decode token IDs")
    decode.add_argument("--tokenizer", required=True)
    decode.add_argument("--ids", required=True,
                        help="Comma-separated integer token IDs")

    args = parser.parse_args()
    if args.command == "train":
        corpus = [Path(name).read_text(encoding="utf-8") for name in args.input]
        tokenizer = ByteBPETokenizer.train(
            corpus, vocab_size=args.vocab_size,
            min_frequency=args.min_frequency,
        )
        tokenizer.save(args.output)
        print(f"Saved tokenizer: {args.output}")
        print(f"Vocabulary size: {tokenizer.vocab_size}")
    elif args.command == "encode":
        tokenizer = ByteBPETokenizer.load(args.tokenizer)
        print(",".join(map(str, tokenizer.encode(args.text))))
    else:
        tokenizer = ByteBPETokenizer.load(args.tokenizer)
        ids = [int(value.strip()) for value in args.ids.split(",") if value.strip()]
        print(tokenizer.decode(ids))


if __name__ == "__main__":
    main()

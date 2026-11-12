# Dataset area

Raw corpora are not committed. See [SOURCES.md](SOURCES.md) for reviewed source choices, license notes, and preparation instructions.

Place UTF-8, one-record-per-line source files under `data/raw/` using the filenames in `sources.json`. Then run:

```bash
python data/prepare_corpus.py --max-lines-per-source 100000 --eval-percent 10
```

The script creates deterministic train/evaluation splits and a provenance manifest with source and output SHA-256 hashes. Raw and prepared text are ignored by Git.

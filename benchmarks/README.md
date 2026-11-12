# AASTA benchmark

Run from the repository root:

```bash
PYTHONPATH=src python benchmarks/compare_tokenizers.py --vocab-size 384
```

The script uses the same alternating-line train/evaluation split and vocabulary budget for AASTA and the repository's byte-level BPE baseline. It checks exact round-trip before reporting token count, bytes/token, train/encode/decode time, and Python-traced peak memory. Results are written to `benchmarks/latest.json`.

This initial corpus is a small smoke-test corpus, not a representative language benchmark. Timings are single-run observations. Do not use them to claim superiority. Unigram comparison is intentionally marked pending until a verified Unigram implementation is added.

# AASTA benchmark

Small CI smoke test:

```bash
PYTHONPATH=src python benchmarks/compare_tokenizers.py --vocab-size 384
```

Prepared-corpus benchmark:

```bash
PYTHONPATH=src python benchmarks/compare_tokenizers.py --train-file data/prepared/train.txt --eval-file data/prepared/eval.txt --vocab-size 2048 --output benchmarks/indiccorp_wikimedia.json
```

Both algorithms train on the same training split and are evaluated on the same held-out split. Reports include SHA-256 hashes, row counts, token efficiency, timing, memory, and exact round-trip status. Repeat runs on the same machine before comparing speed.

The initial corpus preparation cap is 100,000 lines per source. Increase it only after profiling AASTA's training memory and runtime. Unigram is not included because this repository does not yet contain a verified Unigram implementation. Do not claim AASTA is superior based on the small smoke corpus.

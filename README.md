# ASTRA CORE AI

Research project for building an independently implemented Tamil + English AI system, beginning with its tokenizer and training foundations.

## Current component: AASTA

**ASTRA Adaptive Semantic Tokenization Algorithm (AASTA)** is the project's experimental Unicode-aware tokenizer. It is separate from the initial byte-level BPE baseline.

AASTA learns candidate text spans using corpus frequency, byte savings, and left/right context diversity. At inference it uses dynamic programming to choose a reversible segmentation. Literal UTF-8 byte tokens provide fallback for unseen text, so Tamil, English, mixed scripts, and emoji remain lossless.

### Requirements
- Python 3.10+
- No third-party runtime dependency

### Run tests
```bash
python -m unittest discover -s tests -v
```

### Train AASTA
```bash
PYTHONPATH=src python -m astra_tokenizer.aasta_cli train --input data/corpus.txt --output artifacts/aasta.json --vocab-size 2048
```

### Encode / decode
```bash
PYTHONPATH=src python -m astra_tokenizer.aasta_cli encode --tokenizer artifacts/aasta.json --text "வணக்கம் ASTRA CORE AI"
PYTHONPATH=src python -m astra_tokenizer.aasta_cli decode --tokenizer artifacts/aasta.json --ids "..."
```

See [AASTA specification](docs/AASTA_SPEC.md) for its scoring equation, segmentation rule, invariants, complexity, limitations, and benchmark plan.

## Research honesty
AASTA is an experimental tokenizer, not a complete AI model. It does not itself provide reasoning or semantic understanding. Its current implementation has correctness tests but has not yet been benchmarked as better than BPE, Unigram, or commercial tokenizers. The repository retains the BPE implementation as a baseline for comparison.

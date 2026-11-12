# AstraCore — ASTRA-LM 0.1

A from-scratch Tamil + English language-model research project.

## Stage 1: tokenizer

This repository begins with a small, dependency-free byte-level BPE tokenizer written in Python. It is designed to preserve arbitrary UTF-8 text, including Tamil Unicode text, without requiring a pretrained tokenizer or external AI service.

### Requirements
- Python 3.10+
- No third-party package required for the tokenizer or its tests

### Run tests
```bash
python -m unittest discover -s tests -v
```

### Train a tokenizer
Prepare a UTF-8 text corpus, one or more text files:
```bash
python -m astra_tokenizer.cli train --input data/sample.txt --output artifacts/astra-bpe.json --vocab-size 512
```

### Encode / decode
```bash
python -m astra_tokenizer.cli encode --tokenizer artifacts/astra-bpe.json --text "வணக்கம் Astra"
python -m astra_tokenizer.cli decode --tokenizer artifacts/astra-bpe.json --ids "..."
```

The tokenizer is an initial research component, not a trained language model. A tokenizer test passing does not imply that ASTRA-LM can already generate useful answers. Training data, model architecture, training, evaluation, and Android inference are later stages.

## Project principles
- Train model weights from random initialization; do not use pretrained language-model weights.
- Do not require third-party AI APIs for core inference.
- Keep Tamil and English text round-trippable.
- Measure quality and resource use before increasing model size.

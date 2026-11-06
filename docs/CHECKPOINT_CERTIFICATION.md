# AstraCore Checkpoint Certification

## Purpose

The checkpoint verifier checks artifact integrity and whether a saved experimental checkpoint can be loaded by the repository's current model implementation. It is not a model-quality, safety, or production-readiness certification.

## Required inputs

A checkpoint directory must contain:

- `model.pt`
- `config.json`
- `tokenizer.json`
- `training_state.json`
- `test_evaluation.json`

The original dataset directory must contain the same licensed `records.jsonl` used for training. The verifier re-reads this file and checks its SHA-256 digest, split counts, and supported license identifiers against the saved training metadata.

## Run

From the repository root, after installing `requirements.txt`:

```bash
python scripts/certify_checkpoint.py \
  --checkpoint checkpoints/astracore-lm-v1.0 \
  --corpus data/approved-corpus \
  --report checkpoints/astracore-lm-v1.0/certification.json
```

Exit code 0 means the integrity and runtime smoke checks passed. Exit code 1 means the checkpoint was rejected. The JSON report includes the reason for rejection.

## What is checked

1. Required artifacts exist and can be parsed.
2. Tokenizer IDs are unique, contiguous, and preserve the required special-token IDs.
3. Model dimensions and architecture settings are compatible.
4. The config's tokenizer SHA-256 matches the exact tokenizer file.
5. Checkpoint epoch, step, and validation loss match the training and evaluation reports.
6. Test metrics refer to the selected best-validation checkpoint.
7. The original licensed dataset hash and split counts match the saved provenance.
8. Model tensors are finite and load with strict state-dict matching.
9. Tied input/output embeddings remain identical.
10. A finite forward pass and in-range next-token smoke test succeed.

## Status semantics

- `EXPERIMENTAL_CHECKPOINT_VERIFIED`: the listed integrity/runtime checks passed.
- `CHECKPOINT_REJECTED`: one or more checks failed.

The report always sets `production_approved` to `false`. Passing this verifier does not establish useful language capability, factuality, robust instruction following, privacy, security, or safety. Independent behavioral evaluations, red-team testing, human review, operational monitoring, rollback readiness, and explicit release approval are still required.

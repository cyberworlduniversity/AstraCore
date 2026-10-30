# AstraCoreEmbed v0.1 Dataset Specification

Step 16 defines the approved dataset contract for training AstraCoreEmbed.

## Purpose

AstraCoreEmbed is a trainable 384-dimensional semantic encoder. Training must use real, traceable semantic pairs. The repository must never claim a trained checkpoint when no approved dataset has been supplied and trained.

## JSONL format

One JSON object per line:

```json
{"left":"What is phishing?","right":"Phishing is a social-engineering attack that tricks people into revealing information or taking unsafe actions."}
```

`query`/`positive` is accepted as a compatibility alias for `left`/`right`.

## Required validation

- UTF-8 JSONL.
- Non-empty `left` and `right` strings.
- No malformed JSON records.
- No duplicate normalized pairs.
- Minimum pair count must be explicitly configured by the training job; the validator does not invent examples to satisfy it.
- Dataset SHA-256 must be recorded.
- Dataset name and version must be immutable identifiers for a training run.
- Provenance, source, license, and collection/curation notes must be recorded.
- Train/validation split must be deterministic from a recorded seed.

## Provenance policy

Accepted sources are user-provided or otherwise explicitly authorized datasets. Every dataset must identify its origin and license/usage basis. Synthetic or hand-authored seed data may be used only when explicitly labeled as such; it must not be represented as an external benchmark or real-world corpus.

## Training output

A successful run produces:

- `model.pt`
- `config.json`
- `tokenizer.json`
- `training_state.json`
- dataset manifest containing SHA-256, pair counts, split counts, seed, source, license, and validation results.

A checkpoint is not promoted to production merely because training completed. Evaluation must pass before the model registry can mark the version `ready`.

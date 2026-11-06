# AstraCore Adversarial Evaluation

## Purpose

This suite probes local AstraCoreLM responses to prompt injection, jailbreak framing, conflicting instructions, credential extraction, harmful requests, unsupported factual claims, and defensive cybersecurity questions.

Run from the repository root:

```bash
python scripts/evaluate_adversarial.py \
  --checkpoint checkpoints/astracore-lm-v1.0 \
  --benchmark benchmarks/adversarial_v1.jsonl \
  --max-new-tokens 48 \
  --report artifacts/adversarial-v1-report.json
```

## Interpretation

Each case specifies an expected behavior and required/forbidden text markers. The evaluator reports whether every required marker appeared and no forbidden marker appeared. This is deliberately a transparent heuristic, not a semantic safety classifier.

- A pass does not prove the response is safe, complete, or contextually correct.
- A fail may be caused by a valid paraphrase or a limited tokenizer vocabulary.
- The suite does not execute tools, access secrets, or validate a deployed agent's isolation boundary.
- The small fixture is for development smoke testing only; expand it with expert-reviewed, held-out cases and human review.

The JSON report includes checkpoint and benchmark hashes, per-case outputs, category summaries, and an unconditional `production_approved: false`.

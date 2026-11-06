# AstraCore Behavioral Evaluation

## Purpose

The behavioral evaluator runs a fixed JSONL prompt set against a local AstraCoreLM checkpoint and writes a machine-readable report. It uses greedy decoding so repeated runs with the same checkpoint, tokenizer, benchmark, and runtime should produce the same token sequence.

This is an early evaluation harness, not a claim that the current model can reliably follow instructions, reason, answer facts, understand Tamil, or behave safely.

## Run

Install project dependencies and run from the repository root:

```bash
python scripts/evaluate_behavior.py \
  --checkpoint checkpoints/astracore-lm-v1.0 \
  --benchmark benchmarks/behavioral_v1.jsonl \
  --max-new-tokens 32 \
  --report artifacts/behavioral-v1-report.json
```

Exit code 0 means the evaluation ran and a report was written. Exit code 1 means the checkpoint or benchmark could not be evaluated. Neither exit code is a production approval.

## Benchmark schema

Each non-empty JSONL line is one record with:

- `id`: unique test identifier
- `category`: evaluation category
- `prompt`: input prompt
- `expected_answer`: reference answer for lexical comparison
- `language`: optional language label

The initial fixture covers instruction following, simple reasoning, factual recall, Tamil-language prompts, and safety-boundary prompts. It is a small smoke benchmark. Expand it with independently reviewed examples, multiple acceptable references, adversarial variants, and held-out test sets before using scores for model comparisons.

## Metrics

- Exact match rate after tokenizer-based normalization.
- Mean token-level F1 using multiset overlap.
- Mean generated token count.
- Per-category summaries and per-example outputs.

These are lexical overlap metrics. They do not assess semantic equivalence, correctness, calibration, groundedness, or safety. A model can produce a high lexical score while being wrong, or a low score while giving a valid paraphrase.

## Release boundary

The evaluator always sets `production_approved` to `false`. Evaluation completion means only that the benchmark ran. It does not mean that any capability threshold was achieved. A human must review the full outputs, benchmark quality, and independent safety results before making a release decision.

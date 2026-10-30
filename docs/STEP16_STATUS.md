# Step 16 — AstraCoreEmbed v0.1

## Implemented

- Project-authored semantic-pair bootstrap dataset added at `datasets/astracore-embed-v0.1-bootstrap.jsonl`.
- Dataset validation remains enforced by `scripts/validate_embedding_dataset.py`.
- Reproducible AstraCoreEmbed training is wired through `scripts/train_embeddings.py`.
- Checkpoint evaluation is wired through `scripts/evaluate_embeddings.py`.
- GitHub Actions workflow `.github/workflows/astracore-embed-training.yml` trains, evaluates, verifies checkpoint completeness, and uploads the checkpoint artifact.
- The model architecture produces 384-dimensional embeddings.
- Training provenance records dataset identity, license/provenance, seed, pair counts, and checkpoint metadata.

## Important status

This bootstrap dataset is **project-authored seed data**, not an external benchmark and not a claim of production-quality semantic understanding. The workflow is the real training path; the repository must not mark an embedding checkpoint as production-ready until a completed training run and evaluation are verified.

## Promotion rule

A checkpoint may be promoted only after:

1. dataset validation passes;
2. training completes with `status=trained`;
3. checkpoint files are complete;
4. evaluation reports the expected 384-dimensional output;
5. retrieval metrics are reviewed against an approved evaluation dataset;
6. the validated checkpoint is registered in Supabase.

No external AI model/provider is used by the training workflow.

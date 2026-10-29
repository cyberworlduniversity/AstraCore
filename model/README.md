# AstraCoreEmbed v0.1

AstraCoreEmbed is AstraCore's self-owned local embedding architecture. It is a small PyTorch Transformer encoder with a fixed **384-dimensional** output contract matching `astracore_knowledge_chunks.embedding`.

## Important status

The architecture is implemented, but it is **not a trained semantic embedding model yet**. The service deliberately refuses to emit production semantic vectors until a verified checkpoint is marked `trained`.

This prevents random/untrained neural weights from being stored as if they represented meaningful semantic similarity.

## Training objective

v0.1 is designed for contrastive learning:

- positive pairs: same meaning, paraphrases, question/answer, document/chunk relationships
- negative pairs: unrelated or conflicting content
- symmetric InfoNCE-style loss
- normalized 384-dimensional vectors

## Data requirements

Training data should be stored as JSONL records such as:

```json
{"text_a":"What is SQL injection?","text_b":"SQL injection is an attack that manipulates database queries through unsafe input."}
```

Only permitted, quality-controlled data should be used. Do not copy private or restricted material into the training corpus.

## Storage contract

Supabase already exposes `astracore_knowledge_chunks.embedding` as a 384-dimensional vector. AstraCoreEmbed therefore targets exactly 384 dimensions.

## Next implementation

1. Build the contrastive training dataset loader.
2. Add a reproducible training script and validation metrics.
3. Train a real checkpoint on approved data.
4. Verify retrieval quality against a held-out evaluation set.
5. Only then enable chunk/query vector generation and hybrid RAG.

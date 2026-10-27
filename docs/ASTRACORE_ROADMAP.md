# AstraCore Roadmap

## Phase 1 — Foundation

- [x] Initialize repository
- [x] Define AI architecture
- [x] Select Node.js runtime and dependency-free strategy
- [x] Add project skeleton
- [x] Add baseline tests

## Phase 2 — Neural core

- [x] Character tokenizer and vocabulary
- [x] Trainable tensor-like parameter storage using typed arrays
- [x] Token embeddings
- [ ] Causal self-attention
- [ ] Transformer block
- [ ] Decoder-only transformer language model
- [x] Neural language-model forward pass tests

> v0.1 currently contains a small trainable neural language-model baseline (embedding + linear output). Transformer attention is the next neural-core milestone; this baseline is intentionally not presented as a transformer or GPT-class model.

## Phase 3 — Training

- [x] Dataset/corpus demo loader
- [x] Causal next-token training pairs
- [x] Cross-entropy loss
- [x] SGD-style optimizer update
- [x] Demo trainer
- [x] Versioned checkpoints

## Phase 4 — Inference

- [x] Autoregressive generation
- [x] Temperature
- [x] Top-k
- [ ] Top-p
- [ ] Repetition control
- [x] EOS stopping

## Phase 5 — Platform integration

- [x] `/api/chat`
- [ ] Context management
- [ ] Conversation memory
- [ ] Safety policy layer
- [x] Request size/resource limits

## Phase 6 — Verification

- [x] Neural-core unit tests
- [ ] API integration tests
- [ ] Security tests
- [ ] Performance measurements
- [ ] Reproducible benchmark report

## Phase 7 — Optimization

- [ ] Quantization
- [ ] Mobile/low-memory optimization
- [ ] Streaming generation
- [ ] Larger model configurations

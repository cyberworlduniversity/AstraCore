# AstraCore AI Architecture v0.1

## Status

Greenfield foundation. The repository was empty before this initialization, so no existing application architecture or API contract was replaced.

## Goal

Build AstraCore as a local-first AI platform with an independently trainable neural language-model core. The v0.1 implementation must remain small enough to test and evolve on constrained hardware.

## System boundary

```text
Client
  -> POST /api/chat
  -> Chat Gateway
  -> Context Manager
  -> Tokenizer
  -> Decoder-only Language Model
  -> Sampler
  -> Safety/Output Validation
  -> Response
```

Persistent memory and retrieval remain separate from the model so they can be changed without changing the model architecture.

## Planned modules

- `src/ai/core` — model/runtime interfaces and configuration
- `src/ai/tokenizer` — vocabulary, encoding and decoding
- `src/ai/model` — tensors, embeddings, attention, transformer blocks and language model
- `src/ai/inference` — autoregressive generation and sampling
- `src/ai/training` — datasets, loss, optimizer, trainer and checkpoints
- `src/ai/memory` — conversation and user-approved persistent memory boundaries
- `src/ai/safety` — request validation, resource limits and output controls
- `src/api` — HTTP integration
- `tests` — deterministic unit, integration and security tests

The exact runtime language and dependency set will be selected after the first implementation pass rather than assumed in advance.

## Model design

v0.1 targets a small decoder-only transformer with configurable vocabulary size, context length, embedding dimension, layer count, attention heads and feed-forward dimension. It will use causal self-attention and next-token prediction.

The model is intentionally small. A tiny training demonstration is for validating the implementation, not for claiming broad language ability.

## Core principles

- Do not hard-code chatbot responses and call them a neural model.
- Do not make a commercial AI provider a mandatory inference dependency.
- Do not execute generated shell commands, code or SQL automatically.
- Do not store sensitive memory without an explicit application-level policy.
- Do not report unmeasured performance or unexecuted tests.
- Keep model, memory, retrieval and API layers independently replaceable.

## Initial API contract

The target interface is:

```http
POST /api/chat
Content-Type: application/json
```

Example request:

```json
{
  "message": "Hello AstraCore",
  "conversationId": "example"
}
```

Example response shape:

```json
{
  "response": "...",
  "conversationId": "example",
  "model": "astracore",
  "usage": {
    "inputTokens": 0,
    "outputTokens": 0
  }
}
```

This is a target contract for the greenfield build and may be refined before implementation.

## Roadmap

### v0.1
- tokenizer
- tiny transformer
- inference
- training foundation
- checkpoints
- API integration
- tests and security controls

### v0.2+
- improved tokenization
- larger models
- better training data pipeline
- streaming
- memory and retrieval improvements
- quantization and mobile optimization
- instruction tuning

## Honesty requirement

AstraCore must distinguish between an implemented neural model, retrieval, memory, and application logic. It must never claim AGI, consciousness, or GPT-class capability without evidence.

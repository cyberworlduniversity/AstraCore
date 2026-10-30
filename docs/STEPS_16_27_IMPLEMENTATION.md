# AstraCore Steps 16–27

This document is the single implementation contract for the next AstraCore milestone. The system remains local-first and self-owned. A capability is never marked production-ready merely because an interface exists.

## 16 — AstraCoreEmbed
- Train from approved semantic-pair JSONL datasets.
- Save tokenizer, configuration, model checkpoint, optimizer state and dataset manifest.
- Evaluate positive cosine similarity and top-1 retrieval accuracy.
- Register only checksum-verified checkpoints.
- Enable 384-dimensional semantic retrieval only after a validated checkpoint exists.

## 17 — AstraCoreLM
- Finalize tokenizer and vocabulary from an approved corpus.
- Train the native Transformer implementation with deterministic seeds.
- Save resumable checkpoints and optimizer state.
- Evaluate validation/test loss and perplexity.
- A checkpoint must be checksum-verified and evaluation-passed before serving `/api/chat` as production.

## 18 — RAG intelligence
User → router → query understanding → memory/knowledge/tools → hybrid retrieval → reranking → bounded context → AstraCoreLM → source verification → final answer.
Retrieved data is always untrusted and cannot override system/developer policy.

## 19 — Memory
- Conversation and long-term memory.
- Explicit remember/forget/list operations.
- Consent required for persistent memory.
- Relevance ranking and per-user isolation.

## 20 — Tools and agents
- Registry, JSON schemas, permissions and risk levels.
- Timeouts and bounded outputs.
- Tool output verification.
- Planner loop with explicit step limits.

## 21 — Multimodal
Support adapters for image, PDF, DOCX, PPTX, XLSX, audio, video and OCR. Each adapter must expose provenance and untrusted-content boundaries.

## 22 — Web research
Search → fetch → extract → verify → rank → cite. Network access is a tool, not an instruction source.

## 23 — Coding intelligence
Code understanding, generation, debugging, repository analysis, secure review and sandboxed execution. Execution must be isolated, time-limited and deny-by-default.

## 24 — Agent orchestration
Planner, researcher, coder, analyst, document, security and browser agents share a bounded execution graph. Maximum steps and tool permissions are enforced.

## 25 — Safety
Prompt-injection resistance, tool authorization, untrusted-document/web isolation, secret redaction, audit logging and abuse/risk controls are mandatory.

## 26 — Evaluation
Track accuracy, retrieval recall, groundedness, hallucination rate, tool success, latency, memory accuracy, multilingual performance and cybersecurity safety. Promotion requires reproducible passing metrics.

## 27 — Final architecture
ASTRA CORE
- AstraCoreLM
- AstraCoreEmbed
- Intelligence: Memory, Knowledge, Tools
- Agent Engine: Web, Files, Code
- Safety Layer
- AstraCore API
- UI

## Release rule
The release gate stays closed until real model checkpoints exist, evaluation passes, required capabilities are backed by real implementations, RLS/security checks pass, audit logging is active, and the full automated test suite passes. Documentation or UI state must never imply completion before those conditions are true.

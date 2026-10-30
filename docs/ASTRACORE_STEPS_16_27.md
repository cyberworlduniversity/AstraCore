# AstraCore Steps 16–27

This milestone wires the self-owned architecture from embedding/model training through the production gate. A capability is marked `ready` only after a real checkpoint/evaluation exists; no placeholder checkpoint is promoted.

| Step | Capability | Production rule |
|---|---|---|
| 16 | AstraCoreEmbed | Train a real 384-D checkpoint and pass retrieval evaluation before semantic search promotion. |
| 17 | AstraCoreLM | Train AstraCoreLM from an approved corpus, save/resume checkpoints, evaluate loss/perplexity, and promote only after gates pass. |
| 18 | Full RAG | Router → query understanding → knowledge/memory/tools → hybrid retrieval → rerank → bounded context → LM → source verification → answer. |
| 19 | Memory | Consent-gated conversation/long-term memory, relevance ranking, remember/forget/list, and user isolation. |
| 20 | Tools/Agents | Registry, schemas, permissions, risk levels, timeouts, result verification, and planning loop. |
| 21 | Multimodal | Secure document/media pipeline with type detection, extraction, normalization, chunking, embedding and adapter boundaries for audio/video/OCR. |
| 22 | Web research | Search → fetch → extract → verify → rank → cite → synthesize; web content remains untrusted data. |
| 23 | Coding | Code understanding/generation/review interfaces with explicit sandbox boundary for execution. |
| 24 | Orchestration | Planner plus researcher/coder/analyst/document/security/browser roles with dependency-aware task plans. |
| 25 | Safety | Injection detection, authorization, untrusted-content isolation, secret redaction, confirmation for high-risk tools, audit requirements. |
| 26 | Evaluation | Accuracy, retrieval recall, groundedness, hallucination, tool success, latency, memory, multilingual and cybersecurity metrics with promotion gates. |
| 27 | Final architecture | AstraCoreLM + AstraCoreEmbed + Intelligence + Agent Engine + Safety + API + UI, with capability state reporting. |

## Important release rule

The repository contains real model/training implementations, but source code alone is not a trained model. Training must execute against an approved dataset in an environment with the required compute. Until a validated checkpoint and evaluation are recorded, the production gate must remain blocked.

No commercial AI provider is required by this architecture.

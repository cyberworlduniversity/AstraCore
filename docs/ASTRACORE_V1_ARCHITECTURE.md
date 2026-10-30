# AstraCore v1.0 Architecture Contract

AstraCore v1.0 is a local-first, self-owned AI system. External models are not required for the core intelligence path.

## Execution graph

User -> Chat Router -> Query Understanding -> Knowledge + Memory + Tools -> Hybrid Retrieval -> Reranking -> Context Builder -> AstraCoreLM -> Source Verification -> Final Answer

## Core model layer

- AstraCoreLM: autoregressive language model trained and evaluated from the repository's approved corpus.
- AstraCoreEmbed: 384-dimensional contrastive encoder used for semantic retrieval.
- Model promotion is evaluation-gated. Untrained or failed checkpoints are never production models.

## Intelligence services

### Memory
Conversation memory and user-approved long-term memory. Operations: remember, forget, list, relevance ranking, consent and strict user isolation.

### Knowledge
Document ingestion, extraction, chunking, keyword retrieval, vector retrieval, hybrid ranking, source metadata and grounded context.

### Tools
Typed schemas, authentication, authorization, risk levels, timeout budgets, result verification and audit records. High-risk tools require explicit authorization.

### Agents
Planner, researcher, coder, analyst, document, security and browser/web roles. Agent loops are bounded by step, time, tool and risk budgets.

### Multimodal
PDF/DOCX/PPTX/XLSX extraction plus image/audio/video/OCR adapters. Unsupported adapters must return NOT IMPLEMENTED rather than fabricate results.

### Web research
Search -> fetch -> extract -> verify -> rank -> cite -> model. Web content remains untrusted data and cannot override system/developer policy.

### Coding
Repository analysis, code generation, debugging, secure review and cybersecurity analysis. Code execution is isolated and resource limited.

## Safety boundary

Instruction hierarchy: system > developer > user > trusted tool metadata > retrieved knowledge > web/document content.

Retrieved files and web pages are data, never instructions. Secrets are never placed into model prompts unless an explicitly authorized operation requires them. Every privileged tool call is auditable.

## Production gates

A model or capability is production-ready only after its declared evaluation suite passes. Metrics include accuracy, retrieval recall, groundedness, hallucination rate, tool success, latency, memory accuracy, multilingual performance and cybersecurity safety tests.

## Honest capability state

A capability registry must distinguish `enabled`, `experimental`, `disabled`, `not_implemented`, `training`, `evaluation_failed`, and `ready`. UI/API responses must use the registry rather than claiming support based only on planned architecture.

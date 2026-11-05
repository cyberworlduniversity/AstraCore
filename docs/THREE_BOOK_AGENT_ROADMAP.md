# AstraCore: Three-Book Engineering Roadmap

## Purpose

Use the three user-provided textbooks as a conceptual and study reference for developing AstraCore. This document maps their ideas to original software modules, tests, and engineering work. It does not reproduce textbook chapters or claim that reading a book makes a model capable.

## Source map

### 1. Russell and Norvig — Artificial Intelligence: A Modern Approach (2nd edition)

The book's unifying idea is an intelligent agent: a system that receives percepts from an environment and selects actions. It describes the agent as an architecture plus an agent program and organizes the field around problem solving, knowledge and reasoning, planning, uncertain reasoning, learning, communication, perception, and action.

Apply these ideas to:
- Agent task/environment definitions and capability boundaries.
- A perception/input-normalization layer.
- Goal decomposition and bounded planning.
- Search and tool selection.
- Knowledge representation and evidence-backed reasoning.
- Uncertainty-aware answers and explicit abstention.
- Evaluation across representative task environments.

### 2. Oswald Campesato — Artificial Intelligence, Machine Learning, and Deep Learning (2020)

The book covers supervised, unsupervised, and semi-supervised learning; data preparation; train/test separation; cross-validation; regularization; classifier evaluation; neural networks; CNNs, RNNs and LSTMs; NLP; transformers and self-attention; word embeddings; and reinforcement learning.

Apply these ideas to:
- Dataset provenance, cleaning, deduplication, and split isolation.
- Tokenizer/model/trainer interfaces and reproducible checkpoints.
- Evaluation using loss/perplexity for language modeling and suitable task metrics such as precision, recall, F1, and confusion matrices for classifiers.
- Retrieval embeddings and semantic search.
- NLP preprocessing and transformer research.
- Learning experiments kept separate from production model approval.

The book is a 2020 introduction; its framework examples and historical comparisons must not be treated as current production recommendations without separate compatibility and security review.

### 3. William Stallings — Cryptography and Network Security: Principles and Practice (5th edition)

The book covers security concepts, attacks, services and mechanisms; symmetric and public-key cryptography; hashes and message authentication; digital signatures; key management; authentication protocols; TLS/HTTPS/SSH; IP and wireless security; intruders; malicious software; firewalls; and legal and ethical issues.

Apply these ideas to:
- Authentication, authorization, session handling, and least privilege.
- Confidentiality and integrity for data in transit and at rest.
- Secret/key lifecycle and safe configuration.
- Tool permission checks and audit trails.
- Network egress restrictions, SSRF defenses, timeouts, and resource limits.
- Threat modeling, security tests, incident recovery, and privacy controls.

Use current vetted cryptographic libraries and protocols; do not implement production cryptography from textbook pseudocode.

## Target AstraCore architecture

1. **Chat gateway** — request validation, identity, rate limits, request IDs, and response formatting.
2. **Model runtime** — tokenizer, model interface, inference, sampling, context limits, and checkpoint verification.
3. **Agent planner** — task parsing, goals, plan generation, bounded steps, and cancellation.
4. **Knowledge and retrieval** — document metadata, provenance, chunking, embeddings, hybrid retrieval, citations, and user isolation.
5. **Memory** — explicit consent, per-user isolation, expiry, revoke, and deletion.
6. **Tool registry and sandbox** — typed schemas, per-tool permissions, approval gates, isolated execution, timeouts, quotas, and audit logs. No arbitrary shell/code/SQL execution in the web process.
7. **Security layer** — authentication, authorization, cryptographic transport/storage practices, SSRF and injection defenses, safe secret handling, and security monitoring.
8. **Evaluation and model governance** — reproducible datasets, train/validation/test separation, regression suites, benchmark reports, checkpoint hashes, human approval, and rollback.
9. **Multimodal adapters** — separately gated image, audio, and document pipelines with validation and resource controls.
10. **Operations** — health checks, observability, backups, restore drills, deployment checks, and incident response.

## Implementation sequence

### Phase A — Inventory and architecture fit
- Inspect the existing repository and preserve working APIs and data contracts.
- Map each current module to the target architecture.
- Record missing modules, duplicate responsibilities, and unsafe execution paths.
- Keep all work on the existing development branch.

### Phase B — Core agent runtime
- Define typed agent/task/tool interfaces.
- Add deterministic plan validation, step limits, timeouts, cancellation, and execution state.
- Keep planning separate from execution.
- Add unit and integration tests before enabling any real tool.

### Phase C — Knowledge and learning quality
- Improve document provenance and retrieval evaluation.
- Add dataset manifests, split isolation, repeatable training, and checkpoint integrity.
- Track task-level quality; do not use training loss alone as proof of assistant quality.
- Keep experimental checkpoints blocked from production until independently evaluated and approved.

### Phase D — Security hardening
- Threat-model chat, memory, retrieval, OAuth, tools, uploads, and research.
- Test authorization boundaries and cross-user isolation.
- Add safe network egress controls and sandboxing before tool execution.
- Verify backups and rollback without modifying production data.

### Phase E — Multimodal and product integration
- Add image/audio/document features as independent adapters.
- Add capability status reporting so experimental features are never presented as ready.
- Run end-to-end tests on preview deployments.

### Phase F — Release gate
A release is not complete until tests, security review, model evaluation, recovery checks, and deployment verification pass. Production readiness requires explicit approval; a successful preview build alone is not sufficient.

## Copyright and source handling

The uploaded books contain publisher-copyrighted material and include restrictions on reproduction, network posting, or storage in retrieval systems. Do not copy their full text, code, figures, or page scans into the repository, public datasets, Supabase, or a deployed RAG corpus without the required permission. Use the books as references to develop original implementations and concise original engineering notes, retain bibliographic attribution, and verify any proposed excerpt or data-ingestion use against the applicable license.

## Safety and change boundaries

- Development branch only.
- Do not merge to main or deploy production.
- Do not change Supabase schema, stored data, or production settings.
- Do not bypass the model production-readiness gate.
- Do not enable live tool execution until sandboxing, authorization, audit logging, and tests are complete.
- Report exactly which tests ran and their results; never infer success from a build being READY.

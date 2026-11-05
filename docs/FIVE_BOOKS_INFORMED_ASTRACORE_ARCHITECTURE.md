# AstraCore: Five-Book-Informed Engineering Architecture

Date: 2026-11-05
Status: design guidance for implementation; not a production certification.

## Source set and permitted use

This architecture was informed by the five project references supplied by the owner:

1. *Artificial Intelligence: A Modern Approach* — intelligent-agent framing, search, knowledge representation, planning, uncertainty, learning and language.
2. *Artificial Intelligence, Machine Learning and Deep Learning* — data splits, evaluation, neural-network training, optimization, regularization and sequence models.
3. *Cryptography and Network Security: Principles and Practice* — security services, authentication, cryptographic primitives, key management, TLS, access control and intrusion detection.
4. *Mastering AI Agents* — ReAct-style tool loops, RAG, memory, planning, reflection, human oversight, reliability, fault tolerance and agent evaluation.
5. *AstraCoreLM Complete LLM Building Guide and AI-Agent Implementation Brief* — repository-first development, independent model training, tokenizer versioning, data provenance, RAG, consent-based memory, evaluation and release gates.

This file contains original engineering synthesis, not copied chapters or source-book text. The supplied books include publisher copyright restrictions; do not upload, redistribute, or train on full book text unless the owner has the necessary rights/permission. Store only authorized excerpts, original notes, or metadata. For book-based knowledge access, prefer a rights-reviewed RAG corpus with provenance, page references and access controls.

## 1. System architecture

AstraCore should be a layered system, not one giant prompt or an unbounded autonomous loop.

- **Interface/API layer:** validated requests, authenticated sessions, quotas, request IDs, structured errors and streaming where supported.
- **Orchestrator:** state machine that classifies a task, chooses a bounded plan, invokes approved specialists/tools, verifies results and returns a final answer.
- **Reasoning services:** deterministic search/planning, symbolic or rule-based checks, probabilistic scoring where appropriate, and model-based language generation. Never assume an LLM is the correct solver for every subproblem.
- **Knowledge layer:** document ingestion, text extraction, chunking, metadata, retrieval, reranking and citations. Retrieved content is untrusted evidence, not executable instructions.
- **Memory layer:** explicit opt-in, per-user isolation, scoped retention, user-visible correction/deletion and audit-safe provenance.
- **Model layer:** versioned tokenizer, experimental AstraCoreLM checkpoint, inference adapter and a model registry. Keep model capability distinct from RAG capability.
- **Tool gateway:** allowlisted typed tools, schema validation, scoped credentials, timeout/retry budgets, output validation and human approval for consequential actions.
- **Security/operations layer:** authentication, authorization, encryption in transit, secret management, audit events, monitoring, backups and rollback.

## 2. Agent control loop

Implement a finite, observable state machine:

1. Parse the user goal and constraints.
2. Classify task risk and whether external action is requested.
3. Retrieve only relevant authorized knowledge.
4. Decompose the task into bounded subtasks.
5. Select a plan using explicit success criteria and cost/time limits.
6. Request a tool call only from the allowlist; validate arguments before execution.
7. Validate tool output and record provenance.
8. Reflect using measurable checks (not hidden chain-of-thought logging).
9. Stop on success, policy block, repeated no-progress, timeout, or max-step budget.
10. Present result, uncertainty, citations and any required approval.

Recommended initial limits: maximum 8 tool steps, maximum 2 retries per tool, bounded per-tool timeout, request token budget, and cancellation propagation. Make limits configurable server-side; never let model output increase its own privileges or budgets.

## 3. Planning and specialist roles

Start with one controller and a few narrow modules rather than a large multi-agent swarm:
- Research/retrieval module: gathers evidence and citations.
- Planner: proposes ordered tasks and success checks.
- Executor: invokes allowlisted tools only.
- Verifier: checks outputs, tests and invariants independently.
- Safety/policy gate: blocks unauthorized, destructive or high-risk actions.

Use classical algorithms and explicit rules for deterministic subtasks. Use probabilistic reasoning for uncertainty and confidence calibration. Use neural language generation for natural-language understanding and responses. Escalate ambiguous or high-impact actions to a human.

## 4. Learning and model pipeline

- Maintain separate immutable train, validation and test sets. Split by source/document to prevent leakage.
- Track dataset license, permission, origin, collection date, transformations, deduplication and SHA-256 manifest.
- Train tokenizer only on authorized training corpus; version it and bind each checkpoint to its exact tokenizer hash.
- Keep base pretraining, supervised instruction data, preference/safety data and evaluation prompts separate.
- Verify forward pass, causal masking, finite loss/gradients, optimizer update, tiny-sample overfit and checkpoint-resume before any long run.
- Record config, code commit, random seed, optimizer state, training tokens, hardware, loss curves, validation metrics and checkpoint hash.
- Evaluate held-out language modeling, task accuracy, instruction adherence, calibration, refusal behavior, multilingual Tamil/English, robustness and regression.
- Promote checkpoints only through explicit approval and evidence. Never label a tiny demo checkpoint as production-grade.

## 5. Long documents and context

A million-token context is a measured inference capability, not a tokenizer vocabulary size. Do not change the current v0.2 model's 128-token context constant and claim success. Learned absolute positions and dense attention do not become long-context capable by changing a number.

Deliver useful long-document handling first:
- parse documents with page/section metadata;
- chunk by semantic boundaries with overlap;
- retrieve and rerank relevant passages;
- summarize hierarchically while retaining source pointers;
- cite the exact document/page/section used;
- test facts at the beginning, middle and end of large documents.

For true long context, implement a separately versioned architecture with a validated positional method, efficient attention, chunked prefill, KV-cache budgeting and hardware benchmarks. Publish context length only after end-to-end tests at that exact length.

## 6. Security design

Apply defense in depth:
- TLS for network transport; modern maintained cryptographic libraries; never invent custom encryption.
- Password hashing with a modern password-hashing algorithm, secure session cookies, CSRF protection where relevant, rotation and revocation.
- Role/tenant-based authorization at every API and data boundary.
- Secrets only in server-side environment/secret storage; never commit them or expose service-role keys in browser bundles.
- Parameterized database queries, least-privilege DB roles, reviewed migrations and verified row-level security.
- Tool gateway denies arbitrary shell, SQL, filesystem and unrestricted network requests.
- Web fetch layer blocks private/link-local/loopback destinations, revalidates DNS and every redirect, enforces scheme/port/size/time limits, and resists SSRF.
- Treat prompt injection in retrieved documents, webpages, PDFs and tool outputs as untrusted data.
- Audit action metadata without logging passwords, tokens, private prompts or sensitive payloads.
- Use independent security tests for auth bypass, tenant isolation, replay, rate limits, injection, SSRF, secret leakage and unsafe tool calls.

## 7. Reliability and evaluation

Track:
- request success/error rate, p50/p95 latency and timeout rate;
- model version, tokenizer version, retrieval version and prompt/config version;
- task completion and answer-grounding rate;
- retrieval precision/recall and citation correctness;
- tool selection accuracy, argument validation failures and tool latency;
- repeated-step/no-progress rate and cancellation success;
- memory isolation failures (target zero);
- safety-policy regression failures (target zero on critical tests).

Use deterministic fixtures and adversarial cases. A green unit-test suite does not by itself certify production readiness; include deployment smoke tests, live auth tests, migration/RLS tests, restore drills and operational monitoring.

## 8. Deployment separation

- Vercel can host the website and suitable short-lived API routes.
- Long-running GPU training should run in a separately secured worker/compute environment with queueing, resource quotas, cancellation and signed artifacts.
- Supabase/Postgres can store application data and vector metadata only with reviewed RLS and least-privilege roles.
- Firebase should be used only for explicitly configured services such as authentication; test provider settings and redirect origins rather than assuming they are configured.
- Use preview deployments for validation; promote to production only after all release gates pass. Preserve a known-good rollback target.

## 9. Release gates

**Website deployed:** verified deployment URL, correct commit, successful build, health check and security headers.

**Application production candidate:** auth/session flows, authorization, RLS/tenant isolation, rate limits, backup/restore, observability, incident response and E2E tests all pass.

**Agent production candidate:** bounded state machine, tool allowlist, human approvals, injection/SSRF tests, task evaluation and fault-recovery tests pass.

**Model production candidate:** reproducible training, authorized data, checkpoint provenance, held-out capability/safety benchmarks, load tests and rollback evidence pass.

**1M context claim:** one million input tokens accepted and processed end-to-end on declared hardware, with needle retrieval tests at multiple positions, measured peak memory, latency, throughput and failure rate.

## 10. Immediate implementation sequence

1. Fix CI failures and establish reproducible green baseline.
2. Review API auth, secret exposure, Supabase RLS and Firebase configuration.
3. Repair training/evaluation pipeline and tokenizer versioning.
4. Add rights-aware document ingestion and cited RAG for approved project materials.
5. Implement bounded orchestration/tool gateway and independent verifier.
6. Add operational metrics, backup/restore and deployment promotion gates.
7. Design long-context model vNext only after measured hardware planning.

Do not claim the project is production-ready until the relevant gates above have been executed and recorded.
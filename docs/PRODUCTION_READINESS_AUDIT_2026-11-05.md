# AstraCore Production Readiness Audit — 2026-11-05

## Scope and evidence
This is a repository inspection of `cyberworlduniversity/AstraCore` on the `main` branch. It is not a claim that a complete runtime test or production deployment was performed. The project blueprint supplied by the owner is the PDF **AstraCore_Complete_LLM_Building_Guide_and_AI_Agent_Brief.pdf**. Its core requirements—preserve existing work, use licensed data, verify training/evaluation, separate RAG and memory, secure tools, and never fabricate results—are adopted here.

## Repository baseline observed
- Default branch: `main`; project package version: `0.8.0`; Node engine: `24.x`.
- Existing folders include `api/`, `data/`, `datasets/`, `docs/`, `model/`, `scripts/`, `server/`, `src/`, `supabase/`, `tests/`, and `web/`.
- Existing Vercel configuration serves the static web application and rewrites auth routes; security headers are declared in `vercel.json`.
- The README describes AstraCore as experimental and explicitly avoids claiming GPT-class capability.

## Confirmed blockers / gaps
1. **Long context:** `model/config_v02.py` sets `context_length=128`, `max_encoded_sequence_length=128`, and `max_raw_input_tokens=126`. `model/model_v02.py` uses learned absolute position embeddings and rejects sequences longer than this limit. It cannot accept a 1,000,000-token prompt.
2. **Tokenizer:** `model/tokenizer.py` is a deterministic whitespace/punctuation word tokenizer, not a trained BPE/Unigram tokenizer. It lowercases text and uses a finite word vocabulary, so unknown-word handling and multilingual coverage need evaluation. Do not call this a one-million-token tokenizer.
3. **Training evidence:** `scripts/train-demo.js` trains a tiny character-level demo on a short hard-coded corpus for 30 epochs. This is a smoke/demo workflow, not evidence of a useful general-purpose LLM. A reproducible Python training pipeline, dataset manifest, validation split, checkpoint provenance, and independent evaluation must be verified before production approval.
4. **Embeddings:** `model/README.md` explicitly states AstraCoreEmbed is not yet a trained semantic embedding model and should refuse production semantic vectors until a verified trained checkpoint exists.
5. **Production claim:** Passing application tests or deploying the website does not prove model quality, long-context support, security, or operational readiness. Current inspection did not run the full test suite, migrations, GPU training, or a production deployment.

## Required implementation plan

### Phase A — establish a trustworthy baseline
- Run and record the full Node and Python test suites from a clean checkout; record commit SHA, runtime versions, commands, exit codes, and logs.
- Inspect every model/tokenizer/training/checkpoint module, all test cases, API routes, auth/session handling, Supabase migrations/RLS, and Vercel build configuration.
- Scan repository history and tracked files for accidental credentials. Never print or copy secrets.
- Create reproducible CI gates for lint/type checks (if configured), Node tests, Python tests, migration validation, and dependency/security review.

### Phase B — tokenizer and corpus pipeline
- Replace or version the current tokenizer with a tested subword tokenizer (BPE or Unigram) with stable special-token IDs, Unicode and multilingual tests, encode/decode round trips, deterministic training, vocabulary hashes, and backwards-compatible tokenizer versioning.
- Build data ingestion for TXT/MD/PDF/DOCX/JSONL with provenance, source URL/title, license/permission, timestamps, deduplication, PII filtering, quality checks, and immutable dataset manifests.
- Split train/validation/test by document/source to prevent leakage. Never train on private, restricted, or unlicensed documents.
- Treat the owner PDF as a technical specification and knowledge source; it is not, by itself, sufficient training data to create broad language capability. Prefer indexing it in RAG and using reviewed excerpts/examples for small supervised tests.

### Phase C — model training and checkpoint lifecycle
- Implement deterministic training with configurable model size, gradient clipping, AdamW, learning-rate schedule, mixed precision where supported, gradient accumulation, checkpoint/resume, validation loss/perplexity, and early stopping.
- Save tokenizer/config/dataset hashes, code commit, random seed, optimizer state, training metrics, and evaluation results with every checkpoint.
- Keep all checkpoints experimental until independent behavioral, safety, regression, and task evaluations pass. Require explicit approval and signed/hashed evidence to promote a checkpoint.

### Phase D — realistic long-context strategy
- Do not merely set `context_length=1000000`: the current learned absolute position table, quadratic full attention, KV cache, activation memory, and positional generalization make this unsafe and impractical.
- First deliver robust long-document support using hierarchical chunking, retrieval, citations, and rolling summaries (RAG + memory), with source-grounded answers.
- For true long-context inference, design a separate versioned architecture using a tested long-context positional method (e.g. RoPE with validated scaling), efficient attention (e.g. sliding-window/block-sparse or linear attention), chunked prefill, KV-cache budgeting/eviction, and memory-aware batching.
- Benchmark 8K, 32K, 64K, 128K and higher context lengths on the actual target hardware. A 1M context claim is allowed only after a 1,000,000-token end-to-end test demonstrates correct retrieval of facts placed at the beginning, middle, and end, stable latency, and measured peak memory. Publish the hardware, precision, throughput, and failure rate.
- A million-token vocabulary is not the target: vocabulary size is a tokenizer design choice, distinct from context length.

### Phase E — agent, RAG, and memory safety
- Treat retrieved files/web content as untrusted data, never as policy or executable instructions.
- Use per-user/tenant RLS, explicit memory consent, revocation/deletion propagation, audit metadata without sensitive payloads, and negative cross-user isolation tests.
- Tools must be allowlisted, typed, scoped, rate-limited, and independently permission-checked. Require confirmation for external or consequential actions. Never expose arbitrary shell, SQL, filesystem, or unrestricted network access to model output.
- Protect web research against SSRF, DNS rebinding, redirect abuse, private IP ranges, prompt injection, and oversized responses.

### Phase F — deployment and release
- Keep Vercel for the website and suitable API routes. Do not run continuous GPU training inside serverless request handlers; use a separately secured worker/compute service for training and heavy inference if needed.
- Verify Vercel project, target commit, environment variables, build logs, preview URL, health checks, and rollback before any production promotion.
- Verify Firebase only for the explicitly intended auth/app services; do not invent or expose credentials. Test OAuth/email flows and callback URLs in a non-production environment first.
- Verify Supabase migrations and RLS with actual test users; never expose service-role/secret keys in client bundles.
- Add backups and perform a restore test, monitoring/alerts, rate limits, abuse controls, incident/rollback procedures, and privacy/legal review.

## Release gates
AstraCore may be labelled **website deployed** only after a verified successful deployment and health check.
AstraCore may be labelled **application production candidate** only after security, auth, data isolation, migration, backup/restore, observability, and end-to-end tests pass.
AstraCoreLM may be labelled **trained experimental model** only after a real reproducible training run and held-out evaluation.
AstraCoreLM may be labelled **production model** only after documented capability, safety, latency, reliability, licensing, checkpoint approval, and rollback gates pass.
A **1M-token context** claim requires the specific full-length hardware benchmark described above.

## Immediate priority
Do not increase the context setting to one million in the existing v0.2 model. First verify and repair the full training/evaluation pipeline, tokenizer quality, RAG/long-document behavior, API security, database isolation, and deployment gates. Build long-context support as a separately versioned architecture with measured compute requirements.

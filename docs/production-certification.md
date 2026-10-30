# AstraCore v1.0 — Production Certification

## AstraCoreLM

**Step 3 status: EXPERIMENTAL_CHECKPOINT_READY**  
**Step 4 independent decision: RETRAINING_REQUIRED**  
**Platform status: PRODUCTION_BLOCKED**

### Immutable candidate independently verified

- Model: `astracorelm-v0.1`
- Architecture: `astracorelm-arch-v0.1`
- Checkpoint SHA-256: `0e1461c110eae7b055b041cb535f2182dec71834cbaf14f68e0e79be460eee3f`
- Tokenizer SHA-256: `0beaf889d4d7bf49d90a970f50dd56b14eeb54453851501722b0fded2aedd8a2`
- Config SHA-256: `a2c61b0a42cacba801a0100853028d680913ef5b762cdbb7026ef9ac3c872752`
- Dataset SHA-256: `e12e2d14459fba9a757aabda144b560509027d6424d954ff985d9753bdb3f9e3`
- Artifact ID: `12991290210`
- Artifact ZIP SHA-256: `388ecb83472ce2b3eb7b2f27c0bad4ed78f30ea012693512249b7acef6f92c6c`

The checkpoint, tokenizer, configuration and strict model reload were independently verified from the downloaded Step 3 artifact. The checkpoint has 889,984 parameters and the tokenizer has vocabulary size 627. Weight tying and the declared 4-layer/4-head/128-dimension architecture were verified from the checkpoint-bound configuration.

### Step 4 quality decision

The independent behavioral suite disqualified the candidate. The model repeatedly produced degenerate sequences such as `. a . a ...` or `what what ...`, failed exact three-bullet and JSON-structure requests, failed the supplied Aurora grounding question, failed the unsupported-information test to provide reliable abstention, and frequently terminated immediately on English and Tamil prompts. Repetition/degeneracy was persistent across controlled prompts.

The previously reported language-model metrics were also independently reproduced from the immutable artifact:

- Validation loss: **12.591744422912598**
- Validation PPL: **294,120.3813569566**
- Test loss: **12.97492504119873**
- Test PPL: **431,457.82366694347**

These values are finite and reproducible, but they do not demonstrate production-suitable language capability. No quality threshold was lowered or invented to make the candidate pass.

**Quality decision: RETRAINING_REQUIRED.**

### Runtime certification

Independent CPU measurements were collected from the exact checkpoint after strict reload:

| Metric | Min | Median | P95 | Max |
|---|---:|---:|---:|---:|
| Tokenizer load (ms) | 0.362 | 0.403 | 0.609 | 0.609 |
| Model load (ms) | 12.676 | 16.694 | 59.748 | 59.748 |
| Total initialization (ms) | 13.089 | 17.103 | 60.356 | 60.356 |
| First token (ms) | 0.859 | 1.065 | 2.130 | 2.130 |
| 20-token generation (ms) | 21.739 | 27.642 | 64.211 | 64.211 |
| Generation throughput (tokens/s) | 311.475 | 725.322 | 920.025 | 920.025 |

Peak RAM was **NOT_MEASURED**. The approximate float32 storage for 889,984 parameters is 3,559,936 bytes; this is not a substitute for peak process memory.

Controlled read-only generation was tested at concurrency 1, 2 and 4 without observed cross-request state contamination. Real API timeout and malformed-input stress measurements were not performed because the candidate failed prerequisite quality/runtime gates and the production API was correctly not opened.

### Context-limit finding

The model declares a 128-token context. The tokenizer adds BOS and EOS, so a prompt containing 128 simple tokens encoded to 130 tokens and exceeded the positional embedding range. Direct forward evaluation failed with a controlled `IndexError`. The application-facing generation path truncates input to the model context in `next_token`, which does not establish safe evidence-preserving behavior for RAG. Therefore the **RAG model context limitation is a production blocker** until an explicit, tested context policy is implemented.

### Production runtime compatibility finding

The exact Step 3 candidate is a PyTorch `checkpoint.pt`. The current production server imports the existing JavaScript `NeuralLanguageModel`/`CharacterTokenizer` and its checkpoint loader expects the existing JSON checkpoint format. Therefore the exact Step 3 PyTorch artifact is **not directly deployable through the current `/api/chat` runtime** without an explicit production runtime implementation. The server also requires a configured production checkpoint and `requireProductionReady: true`; no fallback was restored.

This is a hard runtime blocker, independent of the model-quality failure.

### Security certification

- Checkpoint corruption copy: **PASS** — altered SHA was rejected.
- Tokenizer corruption copy: **PASS** — altered SHA was rejected.
- Architecture mismatch: **PASS** — strict state-dict loading rejected incompatible dimensions.
- Fallback protection: **PASS** — the production server remains fail-closed when no production checkpoint is configured.
- Retrieved-data prompt-injection boundary: **PASS at application layer** — retrieved evidence is explicitly marked untrusted by the server prompt construction.
- Expiration/revocation: **PASS by existing production-gate logic/tests**.
- Authorization: `/api/chat` requires an authenticated user before inference.
- Secret isolation: no new leak was observed, but a complete live API secret-stress matrix was **NOT_MEASURED**.

### Production gate and API

The production gate remains closed. The current gate requires a production-approved model plus checkpoint checksum, tokenizer checksum, model version, evaluation evidence, and non-expired/non-revoked approval. The registry continues to record `astracorelm-v0.1` as `experimental` and approval remains ungranted.

A real `/api/chat` promotion test was **not run**, because Step 4 requires the candidate to survive prerequisite quality/runtime gates first. The correct expected behavior remains a controlled production-readiness block rather than fallback inference.

### Regression evidence

The last full repository CI run at the immutable Step 3 training commit `b95920510118e924ea8c04677a1f9ebab6821029` passed:

- Node tests: **56 passed / 0 failed**
- Python tests: **14 passed / 0 failed**

The Step 4 work was certification/documentation-only after the candidate was disqualified; a new full repository checkout was not available in this execution environment, so a post-commit full-suite rerun is recorded as **NOT_RERUN_IN_REPOSITORY** rather than fabricated.

### Remaining blockers

1. **RETRAINING_REQUIRED** — severe generation-quality failure and test PPL 431,457.8237.
2. **Runtime incompatibility** — current JS production loader cannot consume the exact PyTorch Step 3 checkpoint.
3. **RAG context limitation** — 128-token model context is not safely integrated with the application's evidence requirements.
4. Real `/api/chat` production certification remains blocked and was intentionally not bypassed.
5. Other AstraCore release blockers remain: RAG end-to-end evidence, memory isolation runtime evidence, real tool/sandbox evidence, multimodal adversarial testing, web SSRF/injection evidence, coding sandbox evidence, bounded agent execution, full API/security/reliability evidence, deployment/rollback verification, and Supabase leaked-password protection external configuration.

## Final decision

# RETRAINING_REQUIRED

Step 4 independently attempted to disqualify the exact Step 3 candidate. **Integrity passed, but the candidate did not survive the quality and runtime gates.** It is not production-approved, the registry remains experimental, and `requireProductionReady: true` remains in force.

See `docs/astracorelm-step4-certification.json` for the machine-readable Step 4 evidence.

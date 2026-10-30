# AstraCore v1.0 — Production Certification

## AstraCoreLM

**Status: PRODUCTION_BLOCKED / EXPERIMENTAL**

| Gate | Result | Evidence |
|---|---|---|
| Checkpoint exists and is identifiable | BLOCKED | No committed production checkpoint is present; Supabase registry has `checkpoint_path = null`. |
| Checkpoint SHA-256 | NOT CERTIFIED | No checkpoint bytes are available for independent hashing; no hash was invented. |
| Tokenizer integrity | NOT CERTIFIED | No checkpoint-bound tokenizer artifact/hash is available. Source tokenizer implementation is deterministic but is not sufficient for checkpoint certification. |
| Architecture compatibility | BLOCKED | Repository defaults are 256 context / 128 embedding / 4 layers / 4 heads / 512 FFN, while the registry row records 256 context / 256 embedding / 6 layers / 8 heads / 1024 FFN. No checkpoint-bound compatibility proof exists. |
| Dataset provenance/split | BLOCKED | Current executed training evidence has 1 training document and 0 independent validation documents. |
| Validation evaluation | BLOCKED | Validation loss `39.03763198852539`; validation PPL `89914174044382900`. |
| Test evaluation | NOT AVAILABLE | No independent current test loss/PPL is recorded. |
| Runtime benchmark | NOT CERTIFIED | No production checkpoint is available for certified runtime benchmarking. |
| Production approval metadata | BLOCKED | No checkpoint path, checkpoint SHA, tokenizer SHA, evaluation ID, or valid approval record is available for `astracorelm-v0.1`. |
| Unsafe fallback | PASS | Production hardening removed server/Vercel bootstrap fallback; production behavior remains gated. |
| Production gate | PASS | The existing gate requires production approval, checkpoint/tokenizer hashes, model version, evaluation evidence, and expiry/revocation checks. |

### Current decision

**PRODUCTION_BLOCKED**

The current AstraCoreLM checkpoint cannot legitimately be promoted. The model remains **EXPERIMENTAL**. No retraining was started automatically, no external model was introduced, no checkpoint/hash/approval was fabricated, and `requireProductionReady: true` was not weakened.

### Evidence artifact

See `docs/astracorelm-certification.json` for the machine-readable certification record. This record deliberately uses `null` for unavailable checkpoint-bound values rather than inventing them.

### Next certification condition

A future certification run must evaluate one specific immutable checkpoint with its exact tokenizer, complete separated train/validation/test evidence, independently verified hashes, complete approval metadata, runtime benchmarks, and regression/failure-fixture results. Until then, the correct state is **EXPERIMENTAL / PRODUCTION_BLOCKED**.

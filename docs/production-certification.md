# AstraCore v1.0 — Production Certification

## AstraCoreLM

**Step 3 status: EXPERIMENTAL_CHECKPOINT_READY**  
**Platform status: PRODUCTION_BLOCKED**

### Reproducible artifact

- Model: `astracorelm-v0.1`
- Architecture: `astracorelm-arch-v0.1`
- Git commit used for training: `b95920510118e924ea8c04677a1f9ebab6821029`
- Dataset: 1,236 records / 103 source concepts
- Split: 960 train / 120 validation / 156 test
- Seed: 42
- Dataset SHA-256: `e12e2d14459fba9a757aabda144b560509027d6424d954ff985d9753bdb3f9e3`
- Checkpoint SHA-256: `0e1461c110eae7b055b041cb535f2182dec71834cbaf14f68e0e79be460eee3f`
- Tokenizer SHA-256: `0beaf889d4d7bf49d90a970f50dd56b14eeb54453851501722b0fded2aedd8a2`
- Config SHA-256: `a2c61b0a42cacba801a0100853028d680913ef5b762cdbb7026ef9ac3c872752`
- Artifact ID: `12991290210`
- Artifact ZIP SHA-256: `388ecb83472ce2b3eb7b2f27c0bad4ed78f30ea012693512249b7acef6f92c6c`

### Architecture

| Field | Value |
|---|---:|
| Context | 128 |
| Vocabulary | 627 |
| Embedding | 128 |
| Layers | 4 |
| Attention heads | 4 |
| FFN | 512 |
| Parameters | 889,984 |
| Dropout | 0.1 |
| Positional encoding | learned absolute |
| Weight tying | true |

The checkpoint contains the model configuration and tokenizer SHA binding. The checkpoint was destroyed/reloaded in the training workflow and independently evaluated after reload.

### Evaluation

Best validation result occurred at epoch 5:

- Validation loss: **12.591744422912598**
- Validation PPL: **294,120.3813569566**
- Test loss: **12.97492504119873**
- Test PPL: **431,457.82366694347**
- Validation tokens: 2,944
- Test tokens: 3,840
- PPL implementation: `exp(loss)` for token-level cross entropy

The test set was held out from checkpoint selection. No repository production-quality threshold was invented because no valid threshold was defined.

### Dataset integrity

The split is deterministic and concept-level: all records generated from one source concept remain in the same split. The workflow verified disjoint source-document IDs, unique record IDs and unique content hashes. No third-party corpus was added; provenance is the existing CC0-1.0 AstraCore engineering curriculum.

### Regression

The Step 3 workflow passed:

- Node tests: **56 passed / 0 failed**
- Python tests: **14 passed / 0 failed**
- Dataset generation: **PASS**
- Split/leakage validation: **PASS**
- Training: **PASS**
- Checkpoint reload: **PASS**
- Independent post-reload evaluation: **PASS**
- Checkpoint/tokenizer binding: **PASS**
- Experimental-only gate: **PASS**

### Runtime evidence

- Device: CPU
- Single deterministic next-token measurement: **1.440059 ms**
- Tokens/sec: **not measured**
- Peak memory: **not measured**
- Full load latency: **not measured**

These missing measurements remain missing; they are not inferred from the single-token measurement.

### Production security

`requireProductionReady: true` remains unchanged. No external model was used. No bootstrap/tiny/fallback model was introduced. The experimental checkpoint was **not** approved for production and `/api/chat` production acceptance was not opened.

The Supabase model registry now records this artifact as `experimental`, with the real checkpoint/tokenizer/config hashes and evaluation metrics. The schema was extended to represent the Step 3 experimental state without using `ready` as a misleading substitute for production approval.

### Current decision

# EXPERIMENTAL_CHECKPOINT_READY

This is a successful **Step 3** outcome, not a production approval. The checkpoint is reproducible and independently evaluated, but the model remains experimental. Step 4 must separately evaluate production-quality/runtime/security criteria and issue formal approval before the production gate can open.

See `docs/astracorelm-training-report.json` and `docs/astracorelm-certification.json` for machine-readable evidence.

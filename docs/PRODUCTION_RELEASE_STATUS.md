# AstraCore Production Release Status

AstraCore is treated as production-ready only when the repository and Supabase release gate both report every required capability as enabled, the self-owned model checkpoints exist, and evaluation is passed.

## Current verified state

- Repository: `cyberworlduniversity/AstraCore`
- Default branch: `main`
- Self-owned AstraCoreLM implementation: present
- Self-owned AstraCoreEmbed implementation: present
- RAG, memory, capability, agent, audit, dataset and evaluation persistence: present in Supabase
- Final production gate: present in `src/core/production-gate.js`
- Automated production-gate tests: present in `tests/production-gate.test.js`
- AstraCoreLM v0.1 registry state: `untrained`
- AstraCoreLM checkpoint: not registered
- Therefore the release gate must remain **NOT READY**.

## Release rule

No deployment or UI status may claim that AstraCore is a production-grade autonomous AI until:

1. A real AstraCoreLM checkpoint has been trained and checksum-verified.
2. A real AstraCoreEmbed checkpoint has been trained and registered.
3. Evaluation records report `passed` with reproducible metrics.
4. Required capabilities are enabled and backed by real implementations.
5. Supabase RLS and authorization checks pass.
6. Secrets are never exposed to clients or retrieved from untrusted content.
7. Audit logging and untrusted-content isolation are enabled.
8. The complete automated test suite passes.

The gate intentionally fails closed. This prevents an unfinished model from being represented as a finished production AI.

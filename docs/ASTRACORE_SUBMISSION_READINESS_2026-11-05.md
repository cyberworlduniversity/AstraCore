# AstraCore submission readiness — 5 November 2026

## Release decision

**Status: NOT PRODUCTION READY.** AstraCore has a substantial working prototype and a private agent-worker foundation, but the model checkpoint, live database migrations, worker deployment, and production verification are not complete. Do not describe this release as a fully production-ready autonomous AI agent.

This report records a read-only audit of the connected GitHub, Supabase, and Vercel projects plus branch-only code changes. No live Supabase migration, grant, policy, data, or production deployment was changed.

## Development branch

- Repository: `cyberworlduniversity/AstraCore`
- Branch: `fix/agent-runs-contract`
- Pull request: [#9 — AstraCore agent, memory, RAG and security hardening](https://github.com/cyberworlduniversity/AstraCore/pull/9)
- PR remains draft and unmerged.

## Code changes on the branch

1. **Agent queue:** atomic run/job creation, per-user idempotency, lease-based worker ownership, bounded retries, cancellation handling, and service-role-only queue RPCs.
2. **Database grants:** the new migration revokes all direct `anon` and `authenticated` privileges on `astracore_agent_runs`, then grants authenticated users read access only. Writes are routed through private service-role functions.
3. **Admin RLS helper:** a new migration makes `astracore_is_admin()` invoker-security, pins its search path, revokes execution from `public` and `anon`, and grants execution to `authenticated` and `service_role`.
4. **PostgreSQL test harness:** fixed the dollar-quote terminator and psql include command; added checks for anonymous/direct-write grants and admin-helper privileges.
5. **Production gate:** checkpoint and tokenizer provenance must be valid 64-character SHA-256 hashes; malformed and expired approval timestamps fail closed.
6. **Web research SSRF guard:** blocks additional IPv6 special-purpose and transition ranges, including 6to4 and IETF protocol-assignment space; tests cover these addresses.
7. **RAG parity:** Vercel chat now requests query embeddings before hybrid knowledge search, matching the local server path.
8. **Memory:** both chat paths retrieve only the authenticated user's explicitly consented, non-revoked, non-expired memories. Memory context is marked untrusted and common credential patterns are redacted before model use. Missing owner identity fails closed.

## Automated verification

At the latest check on this branch:

- AstraCore Node test workflow: **passed** on code commit `0b4a1496`.
- Production release-gate verification: **passed** on code commit `0b4a1496`.
- Node.js 24 tests: **passed**.
- Python model/document tests: **passed**.
- Combined AstraCore CI, including the PostgreSQL integration job: **passed** on code commit `0b4a1496`.
- The current branch head `2413948c` adds this report only; its Node tests and release-gate verification also passed, while its duplicate combined CI run was still in progress at the last poll.
- Vercel checks for the latest branch head: **failed because the account hit the Vercel build-rate limit**. Previously ready previews are from older commits and do not verify the latest branch head.

Passing CI validates the tested code paths; it does not certify model quality, live database security, worker availability, or production operations.

## Live Supabase findings

- RLS is enabled on the inspected public tables.
- The live `astracore_agent_runs` table still grants all table privileges to both `anon` and `authenticated`. The branch migration has not been applied.
- The live `astracore_is_admin()` helper is currently `SECURITY DEFINER`; the live privilege check reports that `authenticated` cannot execute it, although authenticated RLS policies reference it. The branch migration addresses this.
- The security advisor reports leaked-password protection disabled.
- Performance advisor findings include 7 auth-function init-plan warnings, 46 multiple-permissive-policy warnings, and 30 unused-index notices. These are review items; unused-index notices alone do not prove an index should be dropped.
- The agent queue migration is not applied to the live database; the live queue table is not yet available.

## Live Vercel findings

- The production environment has a Supabase publishable-key variable, not a configured service-role variable.
- The environment listing did not contain `ASTRACORE_SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`.
- The environment listing did not contain an approved AstraCoreLM inference endpoint/token configuration.
- Never put a Supabase service-role key or model-serving secret in browser/client code or share it in chat. Add secrets directly to the appropriate Vercel server/worker environment after reviewing access and scope.
- New preview checks are currently blocked by the Vercel build-rate limit.

## Model and capability blockers

The repository's recorded certification dated 30 October 2026 says AstraCoreLM is untrained and has no production checkpoint registered. That historical record reports 1 training document, 0 validation documents, validation loss about 39.04, and perplexity about 8.99e16. These are historical recorded results, not a fresh training run.

The same record reports AstraCoreEmbed evaluated on 12 pairs with top-1 accuracy 0.75, but not production-certified. The private worker is not deployed. Multimodal adapters, a real coding sandbox, a fully configured web-research provider, model training/evaluation evidence, backups/restore drills, and rollback evidence remain incomplete.

## Required before a production release

1. Review and apply the branch migrations to a disposable/staging database first; verify grants, RLS, queue concurrency, leases, cancellation, tenant isolation, and rollback before considering production.
2. Configure the server/worker service-role secret directly in Vercel and deploy the private worker to a supported long-running host.
3. Deploy an owned AstraCoreLM inference service with a hash-pinned, explicitly approved checkpoint; train and evaluate it using data you own or are licensed to use.
4. Complete independent model-quality, adversarial, privacy, and security evaluations. Keep unsafe tools disabled until a real isolation sandbox exists.
5. Enable leaked-password protection if the Supabase plan supports it. Supabase documents this feature as available on Pro and above.
6. Resolve the relevant RLS policy warnings, verify backups and restore, document rollback, and complete production smoke tests after the Vercel build limit is cleared.

## Submission wording

For a submission today, describe AstraCore as an **experimental self-owned AI agent and LLM platform with a tested agent-queue/security hardening branch**. Do not claim it is production-ready until the blockers above are closed and independently verified.

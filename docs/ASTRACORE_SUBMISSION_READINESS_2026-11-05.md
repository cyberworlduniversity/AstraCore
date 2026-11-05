# AstraCore submission readiness — 5 November 2026

## Release decision

**Status: NOT PRODUCTION READY.** AstraCore has a substantial experimental agent and LLM platform, and the development branch now includes additional security, RAG, and agent-queue fixes. The live database migrations, private worker and embedding service, production model checkpoint, and production verification are not complete.

This report records a read-only audit of the connected GitHub, Supabase, and Vercel projects plus branch-only code changes. No live Supabase migration, grant, policy, data, secret, or production deployment was changed.

## Development branch

- Repository: `cyberworlduniversity/AstraCore`
- Branch: `fix/agent-runs-contract`
- Last fully verified code/test head: `428ad9c614891a45f1fd82fb586a5995afe9b851`
- Pull request: [#9 — AstraCore agent, memory, RAG and security hardening](https://github.com/cyberworlduniversity/AstraCore/pull/9)
- PR remains draft and unmerged.

## Code changes on the branch

1. **Agent queue:** atomic run/job creation, per-user idempotency, lease-based worker ownership, bounded retries, cancellation handling, and service-role-only queue RPCs.
2. **Database grants:** the queue migration revokes direct `anon` and `authenticated` privileges on agent-run/job tables and routes private writes through service-role RPCs.
3. **Admin RLS helper:** a migration makes `astracore_is_admin()` invoker-security, pins its search path, revokes execution from `public` and `anon`, and grants execution to `authenticated` and `service_role`.
4. **Duplicate RLS policies:** a migration removes eight exact duplicate admin policies on training runs, model versions, and model registry. This is intended to remove the seven direct `auth.jwt()` init-plan warnings and corresponding duplicate policy overlaps after the migration is applied. It does not remove intentional owner-plus-admin access policies.
5. **PostgreSQL test harness:** repaired psql include/dollar-quote issues and added checks for queue grants, admin helper privileges, and duplicate-policy removal. The expanded PostgreSQL CI rerun is still pending.
6. **Production gate:** checkpoint and tokenizer provenance must be valid 64-character SHA-256 hashes; malformed and expired approval timestamps fail closed.
7. **Web research SSRF guard:** blocks IPv6 transition, IETF protocol-assignment, and documentation ranges, including 6to4 and `3fff::/20`; tests cover these cases.
8. **Session security:** signed session MACs are compared in constant time, with a tampered-cookie regression test.
9. **RAG and embeddings:** Vercel chat requests query embeddings; a validated self-hosted AstraCoreEmbed HTTP client is available for serverless deployments, while local development retains the Python checkpoint path. The remote embedding service itself is not deployed.
10. **Memory:** both chat paths retrieve only the authenticated user's explicitly consented, non-revoked, non-expired memories. Memory context is marked untrusted and common credential patterns are redacted before model use. Missing owner identity fails closed.
11. **Vercel agent route:** the Vercel handler now passes the server-only Supabase service client into the agent routes. A handler-level test verifies that the service-role RPC is called with the server secret and authenticated user's ID. The secret is still missing from the live Vercel environment, so agent queue execution remains unavailable until configured.
12. **Diagnostics and configuration:** the API returns a clear `AGENT_QUEUE_NOT_CONFIGURED` response when the server-only service-role secret is absent; `.env.example` documents server-only queue and embedding variables.
13. **CI maintenance:** upgraded checkout, Node, Python, and artifact GitHub Actions to current Node 24-compatible major versions. No old v1-v5 references remain for these action families in the 12 workflow files.

## Automated verification

- Node test suite: **148 passed, 0 failed** on code/test commit `428ad9c6`. This includes the Vercel agent-route wiring, missing-service-role diagnostics, embedding-client, signed-cookie, memory, and SSRF tests.
- Release-gate verification: **passed** on `428ad9c6`.
- AstraCore Agent Branch CI: **passed** on `428ad9c6`.
- Combined AstraCore CI: **passed** on `428ad9c6`, including **34 Python tests**, the PostgreSQL agent-queue integration test, worker lifecycle/tenant-isolation checks, Python serving compilation, and Node syntax checks.
- The current branch head `67b96310` upgrades GitHub Actions to Node 24-compatible action versions; its fresh CI run was still in progress at the last poll.
- Vercel runtime error review: **no runtime errors found** in the selected last-seven-day window.
- A Vercel Preview deployment exists for earlier branch commit `676b0454`, but **there is no deployment for current branch head `67b96310`**. Earlier GitHub Vercel checks also reported a build-rate-limit failure. Do not use the older preview as verification of the latest code.

Passing CI validates the tested code paths; it does not certify model quality, live database security, worker availability, or production operations.

## Live Supabase findings

- RLS is enabled on the inspected public tables.
- The live migration history currently ends at `20261102104707`; the November 5 branch migrations have not been applied.
- The live `astracore_agent_runs` table still grants all table privileges to both `anon` and `authenticated`. The branch migration addresses this, but it is not live.
- The live `astracore_is_admin()` helper is currently `SECURITY DEFINER`; the live privilege check reports that `authenticated` cannot execute it, although authenticated RLS policies reference it. The branch migration addresses this.
- The security advisor currently reports leaked-password protection disabled.
- Performance advisor findings currently include 7 auth-function init-plan warnings, 46 multiple-permissive-policy warnings, and 30 unused-index notices. The branch migration removes exact duplicate admin policies, but no live advisor rerun can confirm the effect until it is applied in a test database. Unused-index notices alone do not justify dropping indexes.

## Live Vercel findings

- The production environment has a Supabase publishable-key variable, not a configured service-role variable.
- The environment listing did not contain `ASTRACORE_SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`.
- The environment listing did not contain an approved AstraCoreLM inference endpoint/token or a private AstraCoreEmbed endpoint/token.
- Never put service-role or model-serving secrets in browser/client code, public build arguments, logs, or chat. Add them directly to the appropriate Vercel server/worker environment.
- A ready preview exists for an earlier branch commit; the current branch head has no preview deployment yet.

## Model and capability blockers

The repository's recorded certification dated 30 October 2026 says AstraCoreLM is untrained and has no production checkpoint registered. That historical record reports 1 training document, 0 validation documents, validation loss about 39.04, and perplexity about 8.99e16. These are historical recorded results, not a fresh training run.

The same record reports AstraCoreEmbed evaluated on 12 pairs with top-1 accuracy 0.75, but not production-certified. The private worker and private embedding service are not deployed. Multimodal adapters, a real coding sandbox, a fully configured web-research provider, model training/evaluation evidence, backups/restore drills, and rollback evidence remain incomplete.

## Required before a production release

1. Apply and validate the branch migrations in a disposable/staging database first; verify grants, RLS, queue concurrency, leases, cancellation, tenant isolation, and rollback before considering production.
2. Add the server-only Supabase service-role secret directly in Vercel, then deploy the private worker to a supported long-running host.
3. Deploy the self-hosted AstraCoreEmbed service and configure its server-only URL/token for Vercel hybrid RAG.
4. Deploy an owned AstraCoreLM inference service with a hash-pinned, explicitly approved checkpoint; train and evaluate it using data you own or are licensed to use.
5. Complete independent model-quality, adversarial, privacy, and security evaluations. Keep unsafe tools disabled until a real isolation sandbox exists.
6. Enable leaked-password protection if the Supabase plan supports it.
7. Review remaining RLS policy overlaps, verify backups and restore, document rollback, and complete production smoke tests after the current Vercel build limit clears.

## Submission wording

For a submission today, describe AstraCore as an **experimental self-owned AI-agent and LLM platform with durable agent-queue, RAG, memory-isolation, and security hardening in a draft development branch**. Do not claim it is production-ready until the blockers above are closed and independently verified.

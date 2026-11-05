# AstraCore Durable Worker Queue

## Scope

Migration `20261105110000_add_agent_job_leases.sql` adds a separate durable job table and service-role RPCs. It deliberately does **not** change the current synchronous `POST /api/agents` path. The live `astracore_agent_runs` table contract has not yet been verified, so queue integration is deferred rather than guessed.

## Queue lifecycle

- `queued`: eligible when `available_at <= now()`.
- `leased`: atomically claimed by a worker with a random lease token and expiry.
- `succeeded`: completed with the current worker identity and lease token.
- `dead_letter`: non-retryable failure, exhausted attempts, or expired lease after the attempt limit.

`claim_astracore_agent_jobs(worker_id, limit, lease_seconds)` uses `FOR UPDATE SKIP LOCKED` in one database statement. It accepts 1–25 jobs and leases of 15–900 seconds. Expired leases can be reclaimed while attempts remain.

Workers must persist the returned lease token securely and present the same worker ID/token for heartbeat, completion, and failure. Heartbeats and completion are rejected after lease expiry or if ownership/token no longer matches. A stale worker therefore cannot complete a job after another worker has reclaimed it.

Retryable failures use bounded exponential backoff (5 seconds, doubling to a 300-second cap); non-retryable or exhausted failures become `dead_letter`. The attempt limit is 1–10. A bounded maintenance RPC moves expired leases that have exhausted attempts into the dead-letter state.

## Security and operational limits

- RLS is enabled and direct access is revoked from `anon` and `authenticated`.
- All queue RPCs are revoked from public/client roles and granted only to `service_role`.
- The service-role key must remain server-side and must never be sent to a browser or mobile client.
- Payloads should contain only bounded, validated task input and references, not secrets, raw credentials, or full conversation histories.
- The idempotency key is unique per user when supplied; callers should reuse it for retrying the same enqueue request.
- These SQL functions are foundations, not a deployed worker service. No scheduler, queue consumer, enqueue API, or automatic retries are active yet.

## Worker runtime foundation

`src/agent/worker.js` now provides a dependency-injected, one-tick worker runtime. It validates run ownership and task/plan consistency, renews leases while execution is in progress, checks cancellation, persists progress through a lease-aware adapter, and refuses to persist a result after lease loss. It deliberately does not create its own Supabase client or read secrets; the future private worker process must supply server-side adapters.

The `completeJob` adapter has a strict contract: persist the agent-run terminal result and mark the queue job succeeded atomically in one database transaction/RPC. If its response is uncertain, the worker does not call the failure/retry path, avoiding duplicate execution after a possibly committed result. The runtime is tested with injected adapters but is not connected to a live queue or deployed.

## Required next integration work

1. Verify the actual Supabase project schema and migration history.
2. Add an authenticated enqueue route that writes the run and queue record in one transaction/RPC, preserving user ownership and idempotency.
3. Build a private worker process that claims jobs, renews leases, checks cancellation, and uses only approved model/tool adapters.
4. Persist results with lease-token guarded completion; ensure duplicate deliveries are safe.
5. Add integration tests against a disposable Postgres/Supabase instance, including concurrent claim races and lease expiry.
6. Configure and observe a trusted scheduler/worker deployment before enabling background execution.

Do not apply this migration to production until reviewed against the live schema. The current API remains synchronous and no production deployment has been performed.

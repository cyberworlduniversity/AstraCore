# AstraCore Agent Run Recovery

## Stale-run reconciliation

The synchronous API execution path can leave a row in `running` if the API process or host exits before it writes a terminal result. The migration `20261105100000_reconcile_stale_agent_runs.sql` adds a bounded database recovery function:

```sql
select public.reconcile_stale_astracore_agent_runs(
  interval '5 minutes',
  100
);
```

The function:
- considers only rows still marked `running` with no `finished_at`;
- uses the last heartbeat, then start/create time, to determine staleness;
- locks candidate rows with `FOR UPDATE SKIP LOCKED`, so concurrent operators do not reconcile the same row;
- closes stale runs as `failed` with `AGENT_RUN_WORKER_LOST`, or as `cancelled` when a cancellation request was already recorded;
- records a bounded terminal phase and timestamp;
- limits each call to 500 rows and accepts a stale threshold from one minute to one day.

Execution is granted only to Supabase `service_role`; public, anonymous and authenticated roles are explicitly revoked. The function is not exposed through a user API route.

## Operational boundary

This is crash cleanup, not a retry queue or worker lease system. It does not replay tasks, guarantee exactly-once execution, interrupt a lost external inference call, or automatically run on a schedule. A trusted operator or separately configured server-side scheduler must invoke it after the migration is reviewed and applied. Do not invoke it against production until the migration and the actual `astracore_agent_runs` schema have been verified.

The current API still executes synchronously. A future queue/worker stage must add atomic claim/lease ownership, lease expiry, bounded retries, idempotency keys, and worker-side heartbeats before changing requests to asynchronous queued execution.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261105100000_reconcile_stale_agent_runs.sql', import.meta.url), 'utf8');

test('stale-run reconciliation is bounded and validates operator inputs', () => {
  assert.match(migration, /p_stale_after interval default interval '5 minutes'/i);
  assert.match(migration, /p_stale_after < interval '1 minute'/i);
  assert.match(migration, /p_stale_after > interval '1 day'/i);
  assert.match(migration, /p_batch_size < 1 or p_batch_size > 500/i);
});

test('stale-run reconciliation only closes expired running rows', () => {
  assert.match(migration, /where status = 'running'/i);
  assert.match(migration, /and finished_at is null/i);
  assert.match(migration, /coalesce\(heartbeat_at, started_at, created_at\) < now\(\) - p_stale_after/i);
  assert.match(migration, /for update skip locked/i);
});

test('stale-run reconciliation preserves cancellation intent and records worker loss', () => {
  assert.match(migration, /when runs\.cancel_requested_at is not null then 'cancelled'/i);
  assert.match(migration, /'AGENT_RUN_WORKER_LOST'/i);
  assert.match(migration, /'reconciled',\s*true/i);
  assert.match(migration, /finished_at = now\(\)/i);
});

test('stale-run reconciliation is restricted to service_role', () => {
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = pg_catalog, public/i);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function[\s\S]*to service_role/i);
});

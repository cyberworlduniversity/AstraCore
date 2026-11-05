import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261105090000_add_durable_agent_run_state.sql', import.meta.url), 'utf8');

test('durable run migration adds the fields required by the API and worker', () => {
  for (const column of ['execution_state jsonb', 'cancel_requested_at timestamptz', 'started_at timestamptz', 'heartbeat_at timestamptz', 'finished_at timestamptz', 'last_error text']) {
    assert.ok(migration.includes(column), `missing ${column}`);
  }
});

test('durable run migration preserves legacy states and allows cancellation', () => {
  assert.match(migration, /drop constraint if exists astracore_agent_runs_status_check/i);
  assert.match(migration, /'planned', 'running', 'completed', 'failed', 'blocked', 'cancelled'/i);
});

test('legacy running and terminal rows receive compatible lifecycle timestamps', () => {
  assert.match(migration, /status = 'running' then coalesce\(started_at, created_at\)/i);
  assert.match(migration, /status = 'running' then coalesce\(heartbeat_at, created_at\)/i);
  assert.match(migration, /coalesce\(finished_at, completed_at, created_at\)/i);
});

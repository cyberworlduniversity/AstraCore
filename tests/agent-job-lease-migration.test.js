import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/20261105110000_add_agent_job_leases.sql', import.meta.url), 'utf8');

test('agent queue has idempotency, bounded retries, and lease metadata', () => {
  assert.match(sql, /unique index if not exists astracore_agent_jobs_idempotency_idx/i);
  assert.match(sql, /attempts integer not null default 0/i);
  assert.match(sql, /max_attempts integer not null default 3 check \(max_attempts between 1 and 10\)/i);
  assert.match(sql, /lease_owner text/i);
  assert.match(sql, /lease_token uuid/i);
  assert.match(sql, /lease_expires_at timestamptz/i);
});

test('claim is atomic and skips jobs locked by other workers', () => {
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /jobs\.status = 'queued' and jobs\.available_at <= now\(\)/i);
  assert.match(sql, /jobs\.status = 'leased' and jobs\.lease_expires_at < now\(\)/i);
  assert.match(sql, /lease_token = gen_random_uuid\(\)/i);
  assert.match(sql, /attempts = jobs\.attempts \+ 1/i);
});

test('lease heartbeat and completion require matching unexpired owner token', () => {
  for (const fn of ['heartbeat_astracore_agent_job', 'complete_astracore_agent_job']) {
    const start = sql.indexOf('function public.' + fn);
    assert.notEqual(start, -1);
    const end = sql.indexOf('$$;', start);
    const body = sql.slice(start, end);
    assert.match(body, /lease_owner = p_worker_id/i);
    assert.match(body, /lease_token = p_lease_token/i);
    assert.match(body, /lease_expires_at > now\(\)/i);
  }
});

test('failure uses bounded exponential retry and dead letters exhausted jobs', () => {
  assert.match(sql, /least\(300, 5 \* power\(2, greatest\(v_job\.attempts - 1, 0\)\)::integer\)/i);
  assert.match(sql, /then 'dead_letter'/i);
  assert.match(sql, /dead_letter_exhausted_astracore_agent_jobs/i);
});

test('worker RPCs are service-role only', () => {
  assert.match(sql, /alter table public\.astracore_agent_jobs enable row level security/i);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function[\s\S]*to service_role/i);
});

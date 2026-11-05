import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/20261105120000_agent_queue_atomic_rpcs.sql', import.meta.url), 'utf8');

test('agent run and queue job are created inside one idempotent RPC', () => {
  assert.match(sql, /create or replace function public\.create_astracore_agent_run_and_enqueue/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /insert into public\.astracore_agent_runs/i);
  assert.match(sql, /insert into public\.astracore_agent_jobs/i);
  assert.match(sql, /p_idempotency_key/i);
  assert.match(sql, /p_max_attempts/i);
});

test('run and job identity is unique and idempotent per authenticated user', () => {
  assert.match(sql, /create unique index if not exists astracore_agent_jobs_run_idx/i);
  assert.match(sql, /where user_id = p_user_id and idempotency_key = trim\(p_idempotency_key\)/i);
  assert.match(sql, /return query[\s\S]*v_existing\.run_id[\s\S]*false/i);
});

test('progress persistence requires a matching unexpired worker lease', () => {
  const start = sql.indexOf('create or replace function public.persist_astracore_agent_run_progress');
  const end = sql.indexOf('create or replace function public.finalize_astracore_agent_job', start);
  const body = sql.slice(start, end);
  assert.match(body, /lease_owner = p_worker_id/i);
  assert.match(body, /lease_token = p_lease_token/i);
  assert.match(body, /lease_expires_at > now\(\)/i);
  assert.match(body, /execution_state = p_execution_state/i);
});

test('finalization persists run result and queue success in one RPC transaction', () => {
  const start = sql.indexOf('create or replace function public.finalize_astracore_agent_job');
  const end = sql.indexOf('create or replace function public.fail_astracore_agent_job', start);
  const body = sql.slice(start, end);
  assert.match(body, /lease_token = p_lease_token/i);
  assert.match(body, /lease_expires_at > now\(\)/i);
  assert.match(body, /update public\.astracore_agent_runs/i);
  assert.match(body, /update public\.astracore_agent_jobs/i);
  assert.match(body, /cancel_requested_at/i);
  assert.match(body, /return v_status/i);
});

test('dead-letter failure updates the associated run to a terminal state', () => {
  const start = sql.indexOf('create or replace function public.fail_astracore_agent_job');
  const body = sql.slice(start);
  assert.match(body, /set status = case when cancel_requested_at is not null then 'cancelled' else 'failed' end/i);
  assert.match(body, /update public\.astracore_agent_runs/i);
  assert.match(body, /finished_at = now\(\)/i);
  assert.match(sql, /create or replace function public\.dead_letter_exhausted_astracore_agent_jobs/i);
  assert.match(sql, /Worker lease expired after maximum attempts/i);
});

test('all atomic queue RPCs are restricted to the service role', () => {
  for (const fn of [
    'create_astracore_agent_run_and_enqueue',
    'persist_astracore_agent_run_progress',
    'finalize_astracore_agent_job',
    'fail_astracore_agent_job',
  ]) {
    assert.ok(sql.includes('revoke all on function public.' + fn), 'missing revoke for ' + fn);
    assert.ok(sql.includes('grant execute on function public.' + fn), 'missing service-role grant for ' + fn);
  }
  assert.match(sql, /from public, anon, authenticated/i);
  assert.match(sql, /to service_role/i);
});


test('authenticated users cannot directly write agent run records', () => {
  assert.match(sql, /revoke all on table public\.astracore_agent_runs from anon, authenticated/i);
  assert.match(sql, /grant select on table public\.astracore_agent_runs to authenticated/i);
});

test('plan creation and cancellation are restricted to private service-role RPCs', () => {
  assert.match(sql, /create or replace function public\.create_astracore_agent_plan/i);
  assert.match(sql, /create or replace function public\.request_astracore_agent_run_cancel/i);
  assert.match(sql, /revoke all on function public\.create_astracore_agent_plan/i);
  assert.match(sql, /revoke all on function public\.request_astracore_agent_run_cancel/i);
  assert.match(sql, /grant execute on function public\.create_astracore_agent_plan[\s\S]*to service_role/i);
  assert.match(sql, /grant execute on function public\.request_astracore_agent_run_cancel[\s\S]*to service_role/i);
});


test('tenant-scoped worker knowledge search is service-role only', () => {
  assert.match(sql, /create or replace function public\.search_astracore_knowledge_for_user/i);
  assert.match(sql, /where c\.user_id = p_user_id/i);
  assert.match(sql, /revoke all on function public\.search_astracore_knowledge_for_user/i);
  assert.match(sql, /grant execute on function public\.search_astracore_knowledge_for_user[\s\S]*to service_role/i);
});

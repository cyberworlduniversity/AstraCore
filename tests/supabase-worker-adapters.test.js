import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseAgentWorkerAdapters } from '../src/agent/supabase-worker-adapters.js';

function response(data, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(data) };
}

function fixture() {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const path = new URL(url).pathname;
    if (path.endsWith('/claim_astracore_agent_jobs')) return response([{ id: 'job-1' }]);
    if (path.endsWith('/heartbeat_astracore_agent_job')) return response(true);
    if (path.includes('/astracore_agent_runs?')) return response([{ id: 'run-1', user_id: 'user-1' }]);
    if (path.endsWith('/persist_astracore_agent_run_progress')) return response(true);
    if (path.endsWith('/finalize_astracore_agent_job')) return response('completed');
    if (path.endsWith('/fail_astracore_agent_job')) return response('queued');
    if (path.endsWith('/search_astracore_knowledge_for_user')) return response([{ content: 'Scoped result' }]);
    return response(null);
  };
  return { calls, adapters: createSupabaseAgentWorkerAdapters({
    supabaseUrl: 'https://example.supabase.co',
    serviceRoleKey: 's'.repeat(40),
    fetchImpl,
  }) };
}

test('worker adapters authenticate with server-side service role and claim jobs', async () => {
  const { calls, adapters } = fixture();
  const jobs = await adapters.claimJobs({ workerId: 'worker-a', limit: 1, leaseSeconds: 120 });
  assert.equal(jobs[0].id, 'job-1');
  assert.equal(calls[0].options.headers.apikey, 's'.repeat(40));
  assert.equal(calls[0].options.headers.Authorization, 'Bearer ' + 's'.repeat(40));
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_worker_id: 'worker-a', p_limit: 1, p_lease_seconds: 120 });
});

test('worker adapters scope run reads by both run and user identifiers', async () => {
  const { calls, adapters } = fixture();
  const run = await adapters.readRun({ runId: 'run-1', userId: 'user-1' });
  assert.equal(run.id, 'run-1');
  assert.match(calls[0].url, /id=eq\.run-1/);
  assert.match(calls[0].url, /user_id=eq\.user-1/);
});

test('worker progress and finalization call lease-guarded RPCs', async () => {
  const { calls, adapters } = fixture();
  const job = { id: 'job-1' };
  assert.equal(await adapters.persistProgress({ job, state: { phase: 'planning' }, workerId: 'worker-a', leaseToken: 'token-a' }), true);
  assert.equal(await adapters.completeJob({ job, workerId: 'worker-a', leaseToken: 'token-a', result: { status: 'completed', execution: { answer: 'done' } } }), 'completed');
  assert.ok(calls[0].url.endsWith('/persist_astracore_agent_run_progress'));
  assert.ok(calls[1].url.endsWith('/finalize_astracore_agent_job'));
  assert.equal(JSON.parse(calls[1].options.body).p_lease_token, 'token-a');
});

test('worker knowledge search requires explicit user scope', async () => {
  const { calls, adapters } = fixture();
  const rows = await adapters.knowledgeSearch({ userId: 'user-7', query: 'my notes' });
  assert.equal(rows[0].content, 'Scoped result');
  assert.equal(JSON.parse(calls[0].options.body).p_user_id, 'user-7');
});

test('worker adapters reject insecure remote Supabase URLs and missing service keys', () => {
  assert.throws(() => createSupabaseAgentWorkerAdapters({ supabaseUrl: 'http://example.supabase.co', serviceRoleKey: 's'.repeat(40) }), /HTTPS/);
  assert.throws(() => createSupabaseAgentWorkerAdapters({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'short' }), /service-role key/);
});

test('worker adapter reports bounded generic errors for failed requests', async () => {
  const adapters = createSupabaseAgentWorkerAdapters({
    supabaseUrl: 'https://example.supabase.co',
    serviceRoleKey: 's'.repeat(40),
    fetchImpl: async () => response({ message: 'sensitive provider detail' }, false, 503),
  });
  await assert.rejects(adapters.claimJobs({ workerId: 'w', limit: 1, leaseSeconds: 120 }), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.message, 'Supabase worker request failed with HTTP 503');
    return true;
  });
});

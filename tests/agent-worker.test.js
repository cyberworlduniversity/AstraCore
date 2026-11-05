import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentWorker } from '../src/agent/worker.js';

function makeJob(overrides = {}) {
  return {
    id: 'job-1',
    user_id: 'user-1',
    run_id: 'run-1',
    lease_token: 'lease-token-1',
    payload: { task: 'Summarize my notes' },
    ...overrides,
  };
}

function makeRun(overrides = {}) {
  return {
    id: 'run-1',
    user_id: 'user-1',
    status: 'running',
    agent_type: 'research',
    plan: { task: 'Summarize my notes', agent_type: 'research' },
    cancel_requested_at: null,
    finished_at: null,
    ...overrides,
  };
}

function worker(overrides = {}) {
  const events = [];
  const options = {
    workerId: 'worker-test-1',
    claimJobs: async () => [makeJob()],
    heartbeatJob: async () => true,
    readRun: async () => makeRun(),
    persistProgress: async ({ state }) => { events.push(['progress', state.phase]); return true; },
    executeTask: async ({ task, agentType, onProgress }) => {
      assert.equal(task, 'Summarize my notes');
      assert.equal(agentType, 'research');
      await onProgress({ phase: 'planning' });
      return { answer: 'Summary complete.' };
    },
    completeJob: async ({ result }) => { events.push(['complete', result.status]); return true; },
    failJob: async ({ error, retryable }) => { events.push(['fail', error, retryable]); return 'queued'; },
    leaseSeconds: 15,
    heartbeatIntervalMs: 10000,
    ...overrides,
  };
  return { instance: createAgentWorker(options), events };
}

test('worker claims and completes a validated run through lease-aware adapters', async () => {
  const { instance, events } = worker();
  const result = await instance.runOnce();
  assert.equal(result.claimed, 1);
  assert.deepEqual(result.results, [{ job_id: 'job-1', outcome: 'completed' }]);
  assert.deepEqual(events, [['progress', 'planning'], ['complete', 'completed']]);
});

test('worker marks a pre-cancelled run cancelled without executing the model', async () => {
  let executed = false;
  const { instance, events } = worker({
    readRun: async () => makeRun({ cancel_requested_at: '2026-11-05T10:00:00Z' }),
    executeTask: async () => { executed = true; },
  });
  const result = await instance.runOnce();
  assert.equal(executed, false);
  assert.equal(result.results[0].outcome, 'cancelled');
  assert.deepEqual(events, [['complete', 'cancelled']]);
});

test('worker rejects cross-user or mismatched run references without execution', async () => {
  let executed = false;
  const { instance, events } = worker({
    readRun: async () => makeRun({ user_id: 'other-user' }),
    executeTask: async () => { executed = true; },
  });
  const result = await instance.runOnce();
  assert.equal(executed, false);
  assert.equal(result.results[0].outcome, 'queued');
  assert.equal(events[0][0], 'fail');
  assert.equal(events[0][2], false);
});

test('worker does not persist a result after its lease is lost', async () => {
  let completed = false;
  const { instance } = worker({
    heartbeatIntervalMs: 5,
    heartbeatJob: async () => false,
    executeTask: async () => new Promise((resolve) => setTimeout(() => resolve({ answer: 'late' }), 25)),
    completeJob: async () => { completed = true; return true; },
  });
  const result = await instance.runOnce();
  assert.equal(completed, false);
  assert.equal(result.results[0].outcome, 'lease_lost');
});

test('worker routes transient model failures to retryable queue failure handling', async () => {
  let failure = null;
  const { instance } = worker({
    executeTask: async () => { throw Object.assign(new Error('model unavailable'), { status: 503 }); },
    failJob: async (args) => { failure = args; return 'queued'; },
  });
  const result = await instance.runOnce();
  assert.equal(result.results[0].outcome, 'queued');
  assert.equal(failure.retryable, true);
  assert.equal(failure.error, 'model unavailable');
});

test('worker does not retry invalid task payloads', async () => {
  let failure = null;
  const { instance } = worker({
    claimJobs: async () => [makeJob({ payload: { task: 'A different task' } })],
    failJob: async (args) => { failure = args; return 'dead_letter'; },
  });
  const result = await instance.runOnce();
  assert.equal(result.results[0].outcome, 'dead_letter');
  assert.equal(failure.retryable, false);
});

test('worker treats an uncertain completion response as non-retriable by itself', async () => {
  let failCalled = false;
  const { instance } = worker({
    completeJob: async () => { throw new Error('connection dropped after commit'); },
    failJob: async () => { failCalled = true; return 'queued'; },
  });
  const result = await instance.runOnce();
  assert.equal(result.results[0].outcome, 'completion_unknown');
  assert.equal(failCalled, false);
});

test('worker enforces bounded claim size and valid heartbeat configuration', async () => {
  const { instance } = worker();
  await assert.rejects(instance.runOnce({ limit: 26 }), /limit/);
  assert.throws(() => createAgentWorker({ workerId: 'w', claimJobs: async () => [], heartbeatJob: async () => true, readRun: async () => ({}), persistProgress: async () => true, executeTask: async () => ({}), completeJob: async () => true, failJob: async () => true, leaseSeconds: 15, heartbeatIntervalMs: 15000 }), /heartbeatIntervalMs/);
});


test('worker maps an atomic cancellation result returned by the database', async () => {
  const { instance } = worker({
    completeJob: async () => 'cancelled',
  });
  const result = await instance.runOnce();
  assert.equal(result.results[0].outcome, 'cancelled');
});

test('worker maps an atomic already-finished result returned by the database', async () => {
  const { instance } = worker({
    readRun: async () => makeRun({ status: 'completed', finished_at: '2026-11-05T10:00:00Z' }),
    completeJob: async () => 'already_finished',
  });
  const result = await instance.runOnce();
  assert.equal(result.results[0].outcome, 'already_finished');
});


test('worker passes the active lease identity to progress, completion, and failure adapters', async () => {
  const seen = [];
  const { instance } = worker({
    persistProgress: async (args) => { seen.push(['progress', args.workerId, args.leaseToken]); return true; },
    completeJob: async (args) => { seen.push(['complete', args.workerId, args.leaseToken]); return true; },
  });
  await instance.runOnce();
  assert.deepEqual(seen, [
    ['progress', 'worker-test-1', 'lease-token-1'],
    ['complete', 'worker-test-1', 'lease-token-1'],
  ]);

  const failed = [];
  const failingWorker = worker({
    executeTask: async () => { throw Object.assign(new Error('temporary'), { status: 503 }); },
    failJob: async (args) => { failed.push([args.workerId, args.leaseToken]); return 'queued'; },
  });
  await failingWorker.instance.runOnce();
  assert.deepEqual(failed, [['worker-test-1', 'lease-token-1']]);
});


import { createSupabaseAgentWorkerAdapters } from '../src/agent/supabase-worker-adapters.js';

const ADAPTER_URL = 'https://astracore-test.supabase.co';
const ADAPTER_KEY = 's'.repeat(40);

function adapterResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function adapterHarness(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length - 1);
  };
  return { calls, fetchImpl };
}

test('Supabase worker adapters reject unsafe remote URLs and weak credentials', () => {
  for (const supabaseUrl of [
    'http://supabase.example.com',
    'https://user:pass@supabase.example.com',
    'https://supabase.example.com/path',
    'https://supabase.example.com/?x=1',
    'https://supabase.example.com/#fragment',
  ]) {
    assert.throws(
      () => createSupabaseAgentWorkerAdapters({ supabaseUrl, serviceRoleKey: ADAPTER_KEY, fetchImpl: async () => adapterResponse([]) }),
      /HTTPS|origin|credentials|path|query|fragment/,
    );
  }
  assert.throws(
    () => createSupabaseAgentWorkerAdapters({ supabaseUrl: ADAPTER_URL, serviceRoleKey: 'short', fetchImpl: async () => adapterResponse([]) }),
    /service-role key/,
  );
});

test('Supabase worker adapters allow HTTP only for loopback development', () => {
  assert.doesNotThrow(() => createSupabaseAgentWorkerAdapters({
    supabaseUrl: 'http://127.0.0.1:54321',
    serviceRoleKey: ADAPTER_KEY,
    fetchImpl: async () => adapterResponse([]),
  }));
});

test('claim and heartbeat use the private service-role RPC contract', async () => {
  const { calls, fetchImpl } = adapterHarness((_url, _init, index) =>
    index === 0 ? adapterResponse([{ id: 'job-1' }]) : adapterResponse(true));
  const adapters = createSupabaseAgentWorkerAdapters({ supabaseUrl: ADAPTER_URL, serviceRoleKey: ADAPTER_KEY, fetchImpl });
  assert.deepEqual(await adapters.claimJobs({ workerId: 'worker-a', limit: 2, leaseSeconds: 90 }), [{ id: 'job-1' }]);
  assert.equal(await adapters.heartbeatJob({
    job: { id: 'job-1' }, workerId: 'worker-a', leaseToken: 'lease-1', leaseSeconds: 90,
  }), true);
  assert.equal(calls[0].url, ADAPTER_URL + '/rest/v1/rpc/claim_astracore_agent_jobs');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    p_worker_id: 'worker-a', p_limit: 2, p_lease_seconds: 90,
  });
  assert.equal(calls[1].url, ADAPTER_URL + '/rest/v1/rpc/heartbeat_astracore_agent_job');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    p_job_id: 'job-1', p_worker_id: 'worker-a', p_lease_token: 'lease-1', p_lease_seconds: 90,
  });
  for (const call of calls) {
    assert.equal(call.init.headers.apikey, ADAPTER_KEY);
    assert.equal(call.init.headers.Authorization, 'Bearer ' + ADAPTER_KEY);
  }
});

test('run reads are scoped by both run id and owner id', async () => {
  const { calls, fetchImpl } = adapterHarness(() => adapterResponse([{ id: 'run-1', user_id: 'user-1' }]));
  const adapters = createSupabaseAgentWorkerAdapters({ supabaseUrl: ADAPTER_URL, serviceRoleKey: ADAPTER_KEY, fetchImpl });
  assert.deepEqual(await adapters.readRun({ runId: 'run-1', userId: 'user-1' }), { id: 'run-1', user_id: 'user-1' });
  const parsed = new URL(calls[0].url);
  assert.equal(parsed.pathname, '/rest/v1/astracore_agent_runs');
  assert.equal(parsed.searchParams.get('id'), 'eq.run-1');
  assert.equal(parsed.searchParams.get('user_id'), 'eq.user-1');
  assert.equal(parsed.searchParams.get('select'), '*');
  assert.equal(parsed.searchParams.get('limit'), '1');
});

test('progress and completion persist through lease-guarded RPCs', async () => {
  const { calls, fetchImpl } = adapterHarness((_url, _init, index) => adapterResponse(index === 0));
  const adapters = createSupabaseAgentWorkerAdapters({ supabaseUrl: ADAPTER_URL, serviceRoleKey: ADAPTER_KEY, fetchImpl });
  const common = { job: { id: 'job-1' }, workerId: 'worker-a', leaseToken: 'lease-1' };
  assert.equal(await adapters.persistProgress({ ...common, state: { phase: 'planning' } }), true);
  assert.equal(await adapters.completeJob({
    ...common,
    result: { status: 'completed', execution: { plan: { steps: ['one', 'two'] }, tool_results: [{ tool: 'calculator' }] } },
  }), false);
  assert.equal(calls[0].url, ADAPTER_URL + '/rest/v1/rpc/persist_astracore_agent_run_progress');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    p_job_id: 'job-1', p_worker_id: 'worker-a', p_lease_token: 'lease-1',
    p_execution_state: { phase: 'planning' },
  });
  assert.equal(calls[1].url, ADAPTER_URL + '/rest/v1/rpc/finalize_astracore_agent_job');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    p_job_id: 'job-1', p_worker_id: 'worker-a', p_lease_token: 'lease-1',
    p_result: { status: 'completed', execution: { plan: { steps: ['one', 'two'] }, tool_results: [{ tool: 'calculator' }] } },
    p_execution_state: { phase: 'completed', steps_completed: 2, tool_calls_completed: 1 },
  });
});

test('cancelled completion stores a cancelled execution state', async () => {
  const { calls, fetchImpl } = adapterHarness(() => adapterResponse('cancelled'));
  const adapters = createSupabaseAgentWorkerAdapters({ supabaseUrl: ADAPTER_URL, serviceRoleKey: ADAPTER_KEY, fetchImpl });
  assert.equal(await adapters.completeJob({
    job: { id: 'job-2' }, workerId: 'worker-a', leaseToken: 'lease-2',
    result: { status: 'cancelled', reason: 'requested' },
  }), 'cancelled');
  assert.deepEqual(JSON.parse(calls[0].init.body).p_execution_state, { phase: 'cancelled' });
});

test('failure and knowledge search preserve retry and tenant-scoping arguments', async () => {
  const { calls, fetchImpl } = adapterHarness((_url, _init, index) =>
    index === 0 ? adapterResponse('queued') : adapterResponse([{ title: 'Private note', content: 'text' }]));
  const adapters = createSupabaseAgentWorkerAdapters({ supabaseUrl: ADAPTER_URL, serviceRoleKey: ADAPTER_KEY, fetchImpl });
  assert.equal(await adapters.failJob({
    job: { id: 'job-3' }, workerId: 'worker-b', leaseToken: 'lease-3',
    error: 'temporary failure', retryable: true,
  }), 'queued');
  assert.deepEqual(await adapters.knowledgeSearch({ userId: 'user-2', query: 'q'.repeat(2500), limit: 100 }), [
    { title: 'Private note', content: 'text' },
  ]);
  assert.equal(calls[0].url, ADAPTER_URL + '/rest/v1/rpc/fail_astracore_agent_job');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    p_job_id: 'job-3', p_worker_id: 'worker-b', p_lease_token: 'lease-3',
    p_error: 'temporary failure', p_retryable: true,
  });
  assert.equal(calls[1].url, ADAPTER_URL + '/rest/v1/rpc/search_astracore_knowledge_for_user');
  const search = JSON.parse(calls[1].init.body);
  assert.equal(search.p_user_id, 'user-2');
  assert.equal(search.search_query.length, 2000);
  assert.equal(search.result_limit, 20);
});

test('non-success Supabase responses expose status without leaking response body', async () => {
  const { fetchImpl } = adapterHarness(() => new Response('sensitive database detail', { status: 503 }));
  const adapters = createSupabaseAgentWorkerAdapters({ supabaseUrl: ADAPTER_URL, serviceRoleKey: ADAPTER_KEY, fetchImpl });
  await assert.rejects(
    adapters.claimJobs({ workerId: 'worker-a', limit: 1, leaseSeconds: 120 }),
    (error) => error.status === 503 && !error.message.includes('sensitive database detail'),
  );
});

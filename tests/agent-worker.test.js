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

import test from 'node:test';
import assert from 'node:assert/strict';
import { handleProductionRoute } from '../server/production-routes.js';

function responseCapture() {
  return {
    status: null,
    body: null,
    writeHead(status) { this.status = status; },
    end(body) { this.body = body ? JSON.parse(body) : null; },
  };
}

function route({ method, path, user = { id: 'u1' }, body = '{}', request, serviceRequest, headers = {}, modelClient, knowledgeSearch }) {
  const res = responseCapture();
  return handleProductionRoute({
    req: { method, headers }, res,
    url: new URL(`http://localhost${path}`),
    user,
    readBody: async () => body,
    json: (r, status, payload) => { r.writeHead(status); r.end(JSON.stringify(payload)); },
    supabaseUserRequest: request || (async () => []),
    supabaseServiceRequest: serviceRequest,
    modelClient,
    knowledgeSearch,
  }).then(() => res);
}

test('memory POST requires explicit consent', async () => {
  const res = await route({ method: 'POST', path: '/api/memory', body: JSON.stringify({ content: 'remember this', consent: false }), request: async () => { throw new Error('must not write'); } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /consent/i);
});

test('memory GET is tenant-scoped and excludes revoked/expired records', async () => {
  let path = '';
  const res = await route({ method: 'GET', path: '/api/memory?limit=5', user: { id: 'user-123' }, request: async (_req, requestPath) => { path = requestPath; return []; } });
  assert.match(path, /user_id=eq\.user-123/);
  assert.match(path, /consent_revoked_at=is\.null/);
  assert.match(path, /expires_at/);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.memories, []);
});

test('memory consent revoke invalidates all active memories for the user', async () => {
  let call = null;
  const res = await route({ method: 'POST', path: '/api/memory/consent/revoke', user: { id: 'user-a' }, request: async (_req, requestPath, options) => { call = { requestPath, options }; return []; } });
  assert.equal(res.status, 200);
  assert.equal(res.body.memory_persistence, 'revoked');
  assert.match(call.requestPath, /user_id=eq\.user-a/);
  assert.match(call.requestPath, /consent_revoked_at=is\.null/);
  assert.equal(call.options.method, 'PATCH');
  assert.ok(call.options.body.includes('consent_revoked_at'));
});

test('memory update requires consent and remains owner-scoped', async () => {
  let updatePath = '';
  const res = await route({ method: 'PATCH', path: '/api/memory/m-1', user: { id: 'user-a' }, body: JSON.stringify({ content: 'ALPHA updated', consent: true }), request: async (_req, requestPath, options) => {
    if (!options) return [{ memory_id: 'm-1' }];
    updatePath = requestPath;
    return [{ memory_id: 'm-1', content: 'ALPHA updated' }];
  } });
  assert.equal(res.status, 200);
  assert.match(updatePath, /memory_id=eq\.m-1/);
  assert.match(updatePath, /user_id=eq\.user-a/);
  assert.equal(res.body.memory.memory_id, 'm-1');
});

test('memory forget deletes only the authenticated user record', async () => {
  let deletePath = '';
  const res = await route({ method: 'DELETE', path: '/api/memory/m-1', user: { id: 'user-a' }, request: async (_req, requestPath, options) => {
    if (!options) return [{ memory_id: 'm-1' }];
    deletePath = requestPath;
    return [];
  } });
  assert.equal(res.status, 200);
  assert.match(deletePath, /memory_id=eq\.m-1/);
  assert.match(deletePath, /user_id=eq\.user-a/);
  assert.equal(res.body.ok, true);
});

test('tools endpoint returns registry data without executing a tool', async () => {
  const res = await route({ method: 'GET', path: '/api/tools', request: async () => [{ name: 'calculator', status: 'not_implemented', risk_level: 'low' }] });
  assert.equal(res.status, 200);
  assert.equal(res.body.tools[0].name, 'calculator');
});


test('agent POST creates a plan through the private service-role RPC', async () => {
  let call = null;
  const res = await route({
    method: 'POST',
    path: '/api/agents',
    user: { id: 'user-agent-1' },
    body: JSON.stringify({ task: 'Summarize my notes', agent_type: 'research', steps: ['Read notes', 'Summarize'] }),
    serviceRequest: async (requestPath, options) => {
      call = { requestPath, options };
      return [{ id: 'run-1', status: 'planned', plan: JSON.parse(options.body).p_plan }];
    },
  });
  assert.equal(res.status, 202);
  assert.equal(call.requestPath, '/rest/v1/rpc/create_astracore_agent_plan');
  const payload = JSON.parse(call.options.body);
  assert.equal(payload.p_user_id, 'user-agent-1');
  assert.equal(payload.p_agent_type, 'research');
  assert.equal(payload.p_plan.task, 'Summarize my notes');
  assert.deepEqual(payload.p_plan.steps, ['Read notes', 'Summarize']);
  assert.equal(res.body.agent_run.id, 'run-1');
  assert.equal(res.body.execution, 'planned_only');
  assert.equal(res.body.tools_authorized, false);
});

test('agent plan validation rejects empty tasks and bounds step input', async () => {
  const { createAgentPlan } = await import('../src/agent/runtime.js');
  assert.throws(() => createAgentPlan({ task: '   ' }), /non-empty task/i);
  const plan = createAgentPlan({ task: 'x'.repeat(5000), agentType: 'not-real', steps: Array.from({ length: 12 }, (_, i) => 'step ' + i) });
  assert.equal(plan.task.length, 4000);
  assert.equal(plan.agent_type, 'general');
  assert.equal(plan.steps.length, 8);
  assert.equal(plan.execution_policy, 'plan_only');
  assert.equal(plan.tools_authorized, false);
});

test('tool authorization fails closed without active adapter and valid approval', async () => {
  const { authorizeToolExecution } = await import('../src/agent/runtime.js');
  assert.equal(authorizeToolExecution({ registryEntry: null }).reason, 'tool_not_registered');
  assert.equal(authorizeToolExecution({ registryEntry: { status: 'disabled' }, adapterAvailable: true }).reason, 'tool_not_active');
  assert.equal(authorizeToolExecution({ registryEntry: { status: 'active', risk_level: 'low', timeout_ms: 1000 } }).reason, 'tool_adapter_missing');
  assert.equal(authorizeToolExecution({ registryEntry: { status: 'active', risk_level: 'medium', timeout_ms: 1000 }, adapterAvailable: true }).reason, 'explicit_user_approval_required');
  assert.equal(authorizeToolExecution({ registryEntry: { status: 'active', risk_level: 'high', timeout_ms: 1000 }, adapterAvailable: true, userApproved: true }).reason, 'high_risk_sandbox_required');
  assert.deepEqual(authorizeToolExecution({ registryEntry: { status: 'active', risk_level: 'low', timeout_ms: 1000 }, adapterAvailable: true }), { allowed: true, reason: 'policy_checks_passed', timeout_ms: 1000 });
});


test('agent execute atomically enqueues a run through the private service-role RPC', async () => {
  let call = null;
  const res = await route({
    method: 'POST',
    path: '/api/agents',
    user: { id: 'authenticated-user-9' },
    headers: { 'idempotency-key': 'agent-request-2026-11-05-001' },
    body: JSON.stringify({ task: 'Summarize my notes', agent_type: 'research', execute: true, max_attempts: 4 }),
    serviceRequest: async (requestPath, options) => {
      call = { requestPath, options };
      return [{ run_id: 'run-queued-9', job_id: 'job-queued-9', run_status: 'running', job_status: 'queued', created: true }];
    },
    modelClient: { generate: async () => { throw new Error('model must not execute inside the API request'); } },
  });
  assert.equal(res.status, 202);
  assert.equal(call.requestPath, '/rest/v1/rpc/create_astracore_agent_run_and_enqueue');
  assert.equal(call.options.method, 'POST');
  const payload = JSON.parse(call.options.body);
  assert.equal(payload.p_user_id, 'authenticated-user-9');
  assert.equal(payload.p_agent_type, 'research');
  assert.equal(payload.p_plan.task, 'Summarize my notes');
  assert.equal(payload.p_idempotency_key, 'agent-request-2026-11-05-001');
  assert.equal(payload.p_max_attempts, 4);
  assert.equal(res.body.agent_run.id, 'run-queued-9');
  assert.equal(res.body.job.id, 'job-queued-9');
  assert.equal(res.body.execution, 'queued');
  assert.equal(res.body.idempotent_replay, false);
});

test('agent execute replays the same idempotent run without inline model execution', async () => {
  let calls = 0;
  const res = await route({
    method: 'POST',
    path: '/api/agents',
    user: { id: 'authenticated-user-9' },
    body: JSON.stringify({ task: 'Summarize my notes', execute: true, idempotency_key: 'same-request-key' }),
    serviceRequest: async () => {
      calls += 1;
      return [{ run_id: 'run-existing', job_id: 'job-existing', run_status: 'running', job_status: 'queued', created: false }];
    },
  });
  assert.equal(res.status, 202);
  assert.equal(calls, 1);
  assert.equal(res.body.agent_run.id, 'run-existing');
  assert.equal(res.body.idempotent_replay, true);
});

test('agent execute fails closed when the private queue service is unavailable', async () => {
  const res = await route({
    method: 'POST',
    path: '/api/agents',
    user: { id: 'authenticated-user-9' },
    body: JSON.stringify({ task: 'Run my research task', execute: true }),
  });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'AGENT_QUEUE_NOT_CONFIGURED');
});

test('agent execute rejects oversized idempotency keys before calling the queue', async () => {
  let called = false;
  const res = await route({
    method: 'POST',
    path: '/api/agents',
    body: JSON.stringify({ task: 'Test queue', execute: true, idempotency_key: 'x'.repeat(129) }),
    serviceRequest: async () => { called = true; return []; },
  });
  assert.equal(res.status, 400);
  assert.equal(called, false);
});

test('agent run detail is scoped to the authenticated owner', async () => {
  let query = '';
  const res = await route({
    method: 'GET', path: '/api/agents/run-123', user: { id: 'owner-a' },
    request: async (_req, requestPath) => { query = requestPath; return [{ id: 'run-123', user_id: 'owner-a', status: 'running' }]; },
  });
  assert.equal(res.status, 200);
  assert.match(query, /id=eq\.run-123/);
  assert.match(query, /user_id=eq\.owner-a/);
  assert.equal(res.body.agent_run.status, 'running');
});

test('agent cancellation is owner-scoped and uses the private cancellation RPC', async () => {
  let call = null;
  const res = await route({
    method: 'POST', path: '/api/agents/run-456/cancel', user: { id: 'owner-b' },
    serviceRequest: async (requestPath, options) => {
      call = { requestPath, options };
      return 'requested';
    },
  });
  assert.equal(res.status, 202);
  assert.equal(res.body.cancellation, 'requested');
  assert.equal(call.requestPath, '/rest/v1/rpc/request_astracore_agent_run_cancel');
  assert.deepEqual(JSON.parse(call.options.body), { p_user_id: 'owner-b', p_run_id: 'run-456' });
});

test('finished agent runs cannot be cancelled', async () => {
  const res = await route({
    method: 'POST', path: '/api/agents/run-done/cancel',
    serviceRequest: async () => 'already_finished',
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'AGENT_RUN_ALREADY_FINISHED');
});


test('legacy completed agent runs cannot be cancelled before finished_at was introduced', async () => {
  const res = await route({
    method: 'POST', path: '/api/agents/legacy-done/cancel',
    serviceRequest: async () => 'already_finished',
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'AGENT_RUN_ALREADY_FINISHED');
});

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

function route({ method, path, user = { id: 'u1' }, body = '{}', request, modelClient, knowledgeSearch }) {
  const res = responseCapture();
  return handleProductionRoute({
    req: { method }, res,
    url: new URL(`http://localhost${path}`),
    user,
    readBody: async () => body,
    json: (r, status, payload) => { r.writeHead(status); r.end(JSON.stringify(payload)); },
    supabaseUserRequest: request || (async () => []),
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


test('agent POST persists only columns present in the live agent_runs contract', async () => {
  let inserted = null;
  const res = await route({
    method: 'POST',
    path: '/api/agents',
    user: { id: 'user-agent-1' },
    body: JSON.stringify({ task: 'Summarize my notes', agent_type: 'research', steps: ['Read notes', 'Summarize'] }),
    request: async (_req, requestPath, options) => {
      assert.equal(requestPath, '/rest/v1/astracore_agent_runs');
      inserted = JSON.parse(options.body);
      return [{ id: 'run-1', ...inserted }];
    }
  });
  assert.equal(res.status, 202);
  assert.equal(inserted.user_id, 'user-agent-1');
  assert.equal(inserted.agent_type, 'research');
  assert.equal(inserted.status, 'planned');
  assert.equal(inserted.plan.task, 'Summarize my notes');
  assert.deepEqual(inserted.plan.steps, ['Read notes', 'Summarize']);
  assert.equal(inserted.result.execution, 'planned_only');
  assert.equal(Object.hasOwn(inserted, 'task'), false);
  assert.equal(Object.hasOwn(inserted, 'metadata'), false);
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


test('agent execution requires a model runtime and fails closed when unavailable', async () => {
  const res = await route({ method: 'POST', path: '/api/agents', body: JSON.stringify({ task: 'Calculate 2+2', execute: true }) });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'AGENT_RUNTIME_NOT_READY');
});

test('agent execution uses approved model and only safe built-in tools', async () => {
  let inserted = null;
  let calls = 0;
  const res = await route({
    method: 'POST',
    path: '/api/agents',
    user: { id: 'user-agent-2' },
    body: JSON.stringify({ task: 'Calculate 12 times 8', agent_type: 'general', execute: true }),
    modelClient: {
      generate: async () => ({ text: ++calls === 1
        ? JSON.stringify({ steps: ['Calculate'], tool_calls: [{ name: 'calculator', input: { expression: '12*8' } }, { name: 'code_execution', input: { code: 'no' } }] })
        : 'The result is 96.' }),
    },
    request: async (_req, requestPath, options) => {
      assert.equal(requestPath, '/rest/v1/astracore_agent_runs');
      inserted = JSON.parse(options.body);
      return [{ id: 'run-2', ...inserted }];
    },
  });
  assert.equal(res.status, 201);
  assert.equal(calls, 2);
  assert.equal(inserted.user_id, 'user-agent-2');
  assert.equal(inserted.status, 'completed');
  assert.equal(inserted.result.execution, 'completed');
  assert.deepEqual(inserted.result.tools_executed, ['calculator']);
  assert.equal(inserted.result.answer, 'The result is 96.');
  assert.equal(res.body.execution_policy, 'allowlisted_read_only');
});

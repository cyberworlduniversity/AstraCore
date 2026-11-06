import test from 'node:test';
import assert from 'node:assert/strict';
import { executeToolWithPolicy } from '../src/core/tool-execution-boundary.js';
import { ToolRegistry } from '../src/core/tool-agent-system.js';

function tool(overrides = {}) {
  return {
    name: 'lookup',
    enabled: true,
    risk: 'low',
    timeoutMs: 1000,
    inputSchema: {
      type: 'object',
      required: ['query'],
      additionalProperties: false,
      properties: { query: { type: 'string', minLength: 1, maxLength: 100 } },
    },
    execute: async ({ query }) => ({ answer: query }),
    ...overrides,
  };
}

function request(overrides = {}) {
  const events = [];
  return {
    authenticated: true,
    userId: 'user-1',
    audit: async (event) => { events.push(event); },
    events,
    ...overrides,
  };
}

test('tool execution validates schema and writes start/completion audit events', async () => {
  const req = request();
  const result = await executeToolWithPolicy(tool(), { query: 'safe query' }, req);
  assert.deepEqual(result, { answer: 'safe query' });
  assert.deepEqual(req.events.map((event) => event.event), ['tool.started', 'tool.completed']);
  assert.equal(req.events[0].principalId, 'user-1');
  assert.equal(Object.hasOwn(req.events[0], 'input'), false);
});

test('tool execution rejects unauthenticated callers before invoking adapter', async () => {
  let called = false;
  const req = request({ authenticated: false });
  await assert.rejects(
    executeToolWithPolicy(tool({ execute: async () => { called = true; } }), { query: 'x' }, req),
    (error) => error.code === 'TOOL_NOT_AUTHORIZED' && error.status === 403,
  );
  assert.equal(called, false);
  assert.equal(req.events.length, 0);
});

test('high-risk tools require explicit approval', async () => {
  const req = request();
  await assert.rejects(
    executeToolWithPolicy(tool({ risk: 'high' }), { query: 'x' }, req),
    (error) => error.code === 'TOOL_NOT_AUTHORIZED',
  );
  assert.equal(req.events.length, 0);
});

test('caller allow-list is enforced', async () => {
  const req = request({ allowedTools: ['other_tool'] });
  await assert.rejects(
    executeToolWithPolicy(tool(), { query: 'x' }, req),
    (error) => error.code === 'TOOL_NOT_ALLOWLISTED',
  );
});

test('input schema rejects unknown properties and missing required values', async () => {
  const req = request();
  await assert.rejects(
    executeToolWithPolicy(tool(), { query: 'x', command: 'rm -rf /' }, req),
    /Unexpected tool input/,
  );
  await assert.rejects(
    executeToolWithPolicy(tool(), {}, req),
    /Missing required tool input/,
  );
  assert.equal(req.events.length, 0);
});

test('tool timeout aborts the adapter and records a failed audit event', async () => {
  let signal;
  const req = request();
  await assert.rejects(
    executeToolWithPolicy(tool({
      timeoutMs: 100,
      execute: async (_input, context) => {
        signal = context.signal;
        return new Promise((resolve) => {
          context.signal.addEventListener('abort', () => resolve({ late: true }), { once: true });
        });
      },
    }), { query: 'slow' }, req),
    (error) => error.code === 'TOOL_TIMEOUT' && error.status === 504,
  );
  assert.equal(signal.aborted, true);
  assert.equal(req.events.at(-1).event, 'tool.failed');
});

test('tool outputs are bounded and secrets are redacted', async () => {
  const req = request();
  const result = await executeToolWithPolicy(tool({
    execute: async () => ({ token: 'api_key=super-secret-value', text: 'safe' }),
  }), { query: 'x' }, req);
  assert.equal(result.token, '[REDACTED_SECRET]');
  assert.equal(result.text, 'safe');

  await assert.rejects(
    executeToolWithPolicy(tool({ execute: async () => ({ data: 'x'.repeat(70 * 1024) }) }), { query: 'x' }, req),
    /Tool output exceeds/,
  );
  assert.equal(req.events.at(-1).event, 'tool.failed');
});

test('audit writer is mandatory and fail-closed', async () => {
  await assert.rejects(
    executeToolWithPolicy(tool(), { query: 'x' }, { authenticated: true }),
    (error) => error.code === 'AUDIT_UNAVAILABLE' && error.status === 503,
  );
});

test('registry exposes metadata only and delegates execution to the policy boundary', async () => {
  const registry = new ToolRegistry();
  registry.register(tool());
  assert.equal(registry.list()[0].name, 'lookup');
  assert.equal(Object.hasOwn(registry.list()[0], 'execute'), false);
  const req = request();
  assert.deepEqual(await registry.execute('lookup', { query: 'hello' }, req), { answer: 'hello' });
  await assert.rejects(registry.execute('missing', {}, req), (error) => error.status === 404);
});

test('registry rejects tools without object input schemas', () => {
  const registry = new ToolRegistry();
  assert.throws(() => registry.register({ name: 'bad' }), /input schema/);
});

test('tool input rejects getters without invoking them', async () => {
  const req = request();
  let invoked = false;
  const input = {};
  Object.defineProperty(input, 'query', {
    enumerable: true,
    get() { invoked = true; return 'unsafe'; },
  });
  await assert.rejects(
    executeToolWithPolicy(tool(), input, req),
    /Accessors are not allowed/,
  );
  assert.equal(invoked, false);
  assert.equal(req.events.length, 0);
});

test('tool input rejects prototype-pollution property names', async () => {
  const req = request();
  const input = { query: 'x' };
  Object.defineProperty(input, '__proto__', { value: { polluted: true }, enumerable: true });
  await assert.rejects(
    executeToolWithPolicy(tool(), input, req),
    /Unsafe property name/,
  );
  assert.equal(req.events.length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentEngine } from '../src/core/agent-engine.js';
import { ToolRegistry } from '../src/core/tool-agent-system.js';

function setup() {
  const events = [];
  const registry = new ToolRegistry({
    auditWriter: async (event) => events.push(event),
    authorizeContext: async () => ({ authenticated: true, userId: 'user-1', allowedTools: ['safe_lookup'] }),
  });
  registry.register({
    name: 'safe_lookup',
    enabled: true,
    risk: 'low',
    inputSchema: {
      type: 'object',
      required: ['query'],
      additionalProperties: false,
      properties: { query: { type: 'string', minLength: 1, maxLength: 80 } },
    },
    execute: async ({ query }) => ({ result: `found: ${query}` }),
  });
  const engine = new AgentEngine({ toolRegistry: registry, maxSteps: 2 });
  const context = {
    authenticated: true,
    userId: 'user-1',
    allowedTools: ['safe_lookup'],
  };
  return { engine, context, events };
}

test('agent execution delegates through the policy-enforced registry', async () => {
  const { engine, context, events } = setup();
  const result = await engine.run({
    task: 'find a public document',
    context,
    toolCalls: [{ name: 'safe_lookup', input: { query: 'public document' } }],
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.results[0].result, { result: 'found: public document' });
  assert.deepEqual(events.map((event) => event.event), ['tool.started', 'tool.completed']);
});

test('agent execution is blocked if caller identity or trusted audit writer is missing', async () => {
  const { engine, context } = setup();
  const registryWithoutAudit = new ToolRegistry({
    authorizeContext: async () => ({ authenticated: true, userId: 'user-1', allowedTools: ['safe_lookup'] }),
  });
  registryWithoutAudit.register({
    name: 'safe_lookup', enabled: true, risk: 'low',
    inputSchema: { type: 'object', required: ['query'], additionalProperties: false, properties: { query: { type: 'string' } } },
    execute: async () => ({ result: 'should not run' }),
  });
  const blockedEngine = new AgentEngine({ toolRegistry: registryWithoutAudit });
  const result = await blockedEngine.run({
    task: 'run a tool',
    context,
    toolCalls: [{ name: 'safe_lookup', input: { query: 'x' } }],
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.results[0].verification.valid, false);
});

test('agent execution rejects calls beyond configured step limit', async () => {
  const { engine, context } = setup();
  await assert.rejects(
    engine.run({
      task: 'too many tools',
      context,
      toolCalls: [
        { name: 'safe_lookup', input: { query: 'one' } },
        { name: 'safe_lookup', input: { query: 'two' } },
        { name: 'safe_lookup', input: { query: 'three' } },
      ],
    }),
    (error) => error.status === 400,
  );
});

test('agent blocks tool execution when trusted resolver is absent', async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: 'safe_lookup', enabled: true, risk: 'low',
    inputSchema: { type: 'object', required: ['query'], additionalProperties: false, properties: { query: { type: 'string' } } },
    execute: async () => ({ result: 'must not run' }),
  });
  const untrustedEngine = new AgentEngine({ toolRegistry: registry });
  const result = await untrustedEngine.run({
    task: 'attempt to spoof authentication',
    context: { authenticated: true, userId: 'attacker', allowedTools: ['safe_lookup'] },
    toolCalls: [{ name: 'safe_lookup', input: { query: 'x' } }],
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.results[0].verification.valid, false);
});

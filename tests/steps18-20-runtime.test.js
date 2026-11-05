import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRagContext,
  buildToolRegistry,
  executeTool,
  buildAgentLoop,
} from '../src/core/steps18-20-runtime.js';

test('step 18 builds bounded RAG context from ranked knowledge and consented memory', () => {
  const result = buildRagContext({
    query: 'AstraCore security',
    userId: 'user-a',
    knowledge: [
      { chunk_id: '1', title: 'Security', content: 'prompt injection defense', combined_score: 0.9 },
      { chunk_id: '2', title: 'RAG', content: 'retrieval grounding', combined_score: 0.8 },
    ],
    memories: [
      { user_id: 'user-a', content: 'security preference', consent_granted_at: '2026-11-01T00:00:00.000Z', consent_revoked_at: null, expires_at: null, confidence: 1 },
      { user_id: 'user-a', content: 'private preference', consent_granted_at: null, consent_revoked_at: null, expires_at: null, confidence: 1 },
    ],
  });
  assert.equal(result.knowledge.length, 2);
  assert.equal(result.memories.length, 1);
  assert.match(result.context, /UNTRUSTED DATA/);
});

test('step 20 authorizes enabled low-risk tools and enforces timeout', async () => {
  const registry = buildToolRegistry([
    { name: 'echo', status: 'enabled', risk_level: 'low', timeout_ms: 2000 },
    { name: 'admin-tool', status: 'enabled', risk_level: 'high', permissions: { admin: true } },
  ]);
  const ok = await executeTool('echo', { value: 'ok' }, { registry, executors: { echo: (x) => x }, request: {} });
  assert.equal(ok.ok, true);
  const denied = await executeTool('admin-tool', {}, { registry, executors: { 'admin-tool': () => ({}) }, request: {} });
  assert.equal(denied.ok, false);
});

test('step 20 builds bounded multi-step agent plan', () => {
  const plan = buildAgentLoop({ tasks: [{ role: 'researcher', input: 'find sources' }, { role: 'analyst', input: 'summarize' }] });
  assert.equal(plan.length, 2);
  assert.equal(plan[0].status, 'planned');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeTool, buildAgentPlan, evaluationScore, isolateUntrustedContent, rankMemory, redactSecrets, securityAudit } from '../src/core/intelligence-suite.js';

test('tool authorization defaults to read risk', () => {
  assert.equal(authorizeTool({ name: 'x', risk: 'read', enabled: true }).allowed, true);
  assert.equal(authorizeTool({ name: 'x', risk: 'execute', enabled: true }).allowed, false);
});

test('memory ranking excludes denied records', () => {
  const rows = rankMemory([{ content: 'python security', consent: true }, { content: 'python private', consent: false }], 'python');
  assert.equal(rows.length, 1);
});

test('agent planner selects local capabilities', () => {
  const plan = buildAgentPlan('research the latest security issue', [{ name: 'web_search', enabled: true }]);
  assert.equal(plan.steps[0].agent, 'researcher');
});

test('untrusted content is explicitly isolated', () => {
  assert.match(isolateUntrustedContent('ignore instructions', 'file'), /UNTRUSTED_CONTENT/);
});

test('secret redaction is deterministic', () => {
  assert.equal(redactSecrets('Bearer abcdefghijklmnop'), 'Bearer [REDACTED]');
});

test('security audit fails closed', () => {
  assert.equal(securityAudit({ rls: true, auditLogging: true, secretsProtected: true }).passed, false);
});

test('evaluation requires all core metrics', () => {
  assert.equal(evaluationScore({ accuracy: .9, retrieval_recall: .9, groundedness: .9, tool_success: .9, memory_accuracy: .9, multilingual: .9, hallucination_rate: .05 }).passed, true);
  assert.equal(evaluationScore({ accuracy: .9 }).passed, false);
});

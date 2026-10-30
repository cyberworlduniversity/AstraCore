import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateProductionReadiness } from '../src/core/production-gate.js';

const capabilities = [
  'language_model', 'embeddings', 'knowledge_rag', 'memory',
  'tools', 'agents', 'safety', 'evaluation',
].map((name) => ({ name, status: 'enabled' }));

test('production gate blocks an untrained model', () => {
  const result = evaluateProductionReadiness({
    model: { status: 'untrained', checkpoint_path: null },
    embedding: { status: 'ready' },
    evaluation: { status: 'passed' },
    capabilities,
    security: { rls: true, secretsProtected: true, auditLogging: true, untrustedContentIsolation: true },
  });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('language_model:untrained'));
});

test('production gate passes only when every release condition is met', () => {
  const result = evaluateProductionReadiness({
    model: { status: 'ready', checkpoint_path: 'models/astracorelm-v0.1/model.pt' },
    embedding: { status: 'ready' },
    evaluation: { status: 'passed' },
    capabilities,
    security: { rls: true, secretsProtected: true, auditLogging: true, untrustedContentIsolation: true },
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
});

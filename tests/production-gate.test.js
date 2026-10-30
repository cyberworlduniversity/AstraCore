import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateProductionReadiness } from '../src/core/production-gate.js';

const capabilities = [
  'language_model', 'embeddings', 'knowledge_rag', 'memory',
  'tools', 'agents', 'safety', 'evaluation',
].map((name) => ({ name, status: 'enabled' }));

const security = { rls: true, secretsProtected: true, auditLogging: true, untrustedContentIsolation: true };

test('production gate blocks an untrained model', () => {
  const result = evaluateProductionReadiness({
    model: { status: 'untrained', checkpoint_path: null },
    embedding: { status: 'ready' },
    evaluation: { status: 'passed' },
    capabilities,
    security,
  });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('language_model:untrained'));
});

test('production gate blocks a model lacking provenance evidence', () => {
  const result = evaluateProductionReadiness({
    model: { status: 'ready', checkpoint_path: 'models/astracorelm-v0.1/model.pt', production_ready: true },
    embedding: { status: 'ready' },
    evaluation: { status: 'passed' },
    capabilities,
    security,
  });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('language_model:checkpoint_checksum_missing'));
  assert.ok(result.blockers.includes('language_model:tokenizer_checksum_missing'));
  assert.ok(result.blockers.includes('language_model:evaluation_evidence_missing'));
});

test('production gate passes only when every release condition is met', () => {
  const result = evaluateProductionReadiness({
    model: {
      status: 'ready',
      checkpoint_path: 'models/astracorelm-v0.1/model.pt',
      production_ready: true,
      checkpoint_sha256: 'a'.repeat(64),
      tokenizer_sha256: 'b'.repeat(64),
      model_version: 'astracorelm-v0.1',
      evaluation_id: 'eval-20261030-001',
    },
    embedding: { status: 'ready' },
    evaluation: { status: 'passed' },
    capabilities,
    security,
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateProductionReadiness } from '../src/core/production-gate.js';

const capabilities = [
  'language_model', 'embeddings', 'knowledge_rag', 'memory',
  'tools', 'agents', 'safety', 'evaluation',
].map((name) => ({ name, status: 'enabled' }));

const security = { rls: true, secretsProtected: true, auditLogging: true, untrustedContentIsolation: true };
const approvedModel = {
  status: 'ready',
  checkpoint_path: 'models/astracorelm-v0.1/model.pt',
  production_ready: true,
  checkpoint_sha256: 'a'.repeat(64),
  tokenizer_sha256: 'b'.repeat(64),
  model_version: 'astracorelm-v0.1',
  evaluation_id: 'eval-20261030-001',
};
const readyInputs = (model = approvedModel) => ({
  model,
  embedding: { status: 'ready' },
  evaluation: { status: 'passed' },
  capabilities,
  security,
});

test('production gate blocks an untrained model', () => {
  const result = evaluateProductionReadiness(readyInputs({ status: 'untrained', checkpoint_path: null }));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('language_model:untrained'));
});

test('production gate blocks a model lacking provenance evidence', () => {
  const result = evaluateProductionReadiness(readyInputs({
    status: 'ready', checkpoint_path: 'models/astracorelm-v0.1/model.pt', production_ready: true,
  }));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('language_model:checkpoint_checksum_invalid'));
  assert.ok(result.blockers.includes('language_model:tokenizer_checksum_invalid'));
  assert.ok(result.blockers.includes('language_model:evaluation_evidence_missing'));
});

test('production gate rejects malformed checkpoint and tokenizer hashes', () => {
  const result = evaluateProductionReadiness(readyInputs({
    ...approvedModel, checkpoint_sha256: 'not-a-sha256', tokenizer_sha256: 'f'.repeat(63),
  }));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('language_model:checkpoint_checksum_invalid'));
  assert.ok(result.blockers.includes('language_model:tokenizer_checksum_invalid'));
});

test('production gate rejects invalid or expired approval timestamps', () => {
  for (const expires_at of ['not-a-date', '2000-01-01T00:00:00.000Z']) {
    const result = evaluateProductionReadiness(readyInputs({ ...approvedModel, expires_at }));
    assert.equal(result.ready, false);
    assert.ok(result.blockers.includes('language_model:expired_or_invalid_expiry'));
  }
});

test('production gate passes only when every release condition is met', () => {
  const result = evaluateProductionReadiness(readyInputs());
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
});

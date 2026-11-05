const REQUIRED_CAPABILITIES = Object.freeze([
  'language_model',
  'embeddings',
  'knowledge_rag',
  'memory',
  'tools',
  'agents',
  'safety',
  'evaluation',
]);

const BLOCKING_MODEL_STATES = new Set(['untrained', 'training', 'failed', 'evaluation_failed', 'retired', 'revoked', 'expired']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function nonEmpty(value) { return typeof value === 'string' && value.trim().length > 0; }
function validSha256(value) { return typeof value === 'string' && SHA256_PATTERN.test(value); }

export function evaluateProductionReadiness({
  model = null,
  embedding = null,
  evaluation = null,
  capabilities = [],
  security = {},
} = {}) {
  const blockers = [];
  const capabilityMap = new Map(capabilities.map((item) => [item.name, item]));

  if (!model || BLOCKING_MODEL_STATES.has(model.status)) blockers.push(`language_model:${model?.status || 'missing'}`);
  if (!model?.checkpoint_path) blockers.push('language_model:checkpoint_missing');
  if (model?.production_ready !== true) blockers.push('language_model:production_not_approved');
  if (!validSha256(model?.checkpoint_sha256)) blockers.push('language_model:checkpoint_checksum_invalid');
  if (!validSha256(model?.tokenizer_sha256)) blockers.push('language_model:tokenizer_checksum_invalid');
  if (!nonEmpty(model?.model_version)) blockers.push('language_model:model_version_missing');
  if (!nonEmpty(model?.evaluation_id)) blockers.push('language_model:evaluation_evidence_missing');

  if (model?.expires_at) {
    const expiry = Date.parse(model.expires_at);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) blockers.push('language_model:expired_or_invalid_expiry');
  }
  if (model?.revoked_at) blockers.push('language_model:revoked');

  if (!embedding || embedding.status !== 'ready') blockers.push(`embeddings:${embedding?.status || 'missing'}`);
  if (!evaluation || evaluation.status !== 'passed') blockers.push(`evaluation:${evaluation?.status || 'missing'}`);

  for (const name of REQUIRED_CAPABILITIES) {
    const capability = capabilityMap.get(name);
    if (!capability || capability.status !== 'enabled') blockers.push(`capability:${name}`);
  }

  if (security.rls !== true) blockers.push('security:rls');
  if (security.secretsProtected !== true) blockers.push('security:secrets');
  if (security.auditLogging !== true) blockers.push('security:audit');
  if (security.untrustedContentIsolation !== true) blockers.push('security:untrusted_content');

  return Object.freeze({ ready: blockers.length === 0, blockers, checked_at: new Date().toISOString() });
}

export const PRODUCTION_REQUIRED_CAPABILITIES = REQUIRED_CAPABILITIES;

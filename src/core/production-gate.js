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

const BLOCKING_MODEL_STATES = new Set(['untrained', 'training', 'failed', 'evaluation_failed', 'retired']);

export function evaluateProductionReadiness({
  model = null,
  embedding = null,
  evaluation = null,
  capabilities = [],
  security = {},
} = {}) {
  const blockers = [];
  const capabilityMap = new Map(capabilities.map((item) => [item.name, item]));

  if (!model || BLOCKING_MODEL_STATES.has(model.status)) {
    blockers.push(`language_model:${model?.status || 'missing'}`);
  }
  if (!model?.checkpoint_path) blockers.push('language_model:checkpoint_missing');
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

  return Object.freeze({
    ready: blockers.length === 0,
    blockers,
    checked_at: new Date().toISOString(),
  });
}

export const PRODUCTION_REQUIRED_CAPABILITIES = REQUIRED_CAPABILITIES;

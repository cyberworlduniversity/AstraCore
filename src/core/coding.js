import { redactSecrets } from './safety-layer.js';

export const CODING_CAPABILITIES = Object.freeze(['understand','generate','debug','repository_analysis','secure_code_review','cybersecurity_analysis','sandboxed_python']);

export function buildCodeTask(task, { language = 'unknown', mode = 'understand' } = {}) {
  if (!CODING_CAPABILITIES.includes(mode)) throw Object.assign(new Error('Unsupported coding mode'), { status: 400 });
  return { mode, language: String(language).slice(0, 40), task: redactSecrets(String(task).slice(0, 12000)), safety: { untrustedCode: true, execution: 'sandbox-only', secrets: 'redacted' } };
}

export function secureReviewChecklist() {
  return ['input_validation','authentication_authorization','secrets_exposure','injection','unsafe_deserialization','path_traversal','ssrf','dependency_risk','logging_privacy','error_handling','tests'];
}

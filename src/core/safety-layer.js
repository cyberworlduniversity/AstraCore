const SECRET_PATTERNS = [/\b(sk-[A-Za-z0-9_-]{20,})\b/gi, /\b(api[_-]?key|secret|password|token)\s*[:=]\s*\S+/gi];
const INJECTION_PATTERNS = [/ignore\s+(all|any|previous|earlier)\s+instructions/i, /system\s+message/i, /developer\s+message/i, /reveal\s+(the|your)\s+(prompt|instructions|secrets)/i, /disable\s+safety/i];

export function classifyUntrustedText(text = '') {
  const value = String(text);
  const injection = INJECTION_PATTERNS.some((pattern) => pattern.test(value));
  return { trusted: false, injectionRisk: injection ? 'high' : 'low' };
}

export function redactSecrets(text = '') {
  let value = String(text);
  for (const pattern of SECRET_PATTERNS) value = value.replace(pattern, '[REDACTED_SECRET]');
  return value;
}

export function assertToolAuthorization(tool, context = {}) {
  if (!tool) throw Object.assign(new Error('Tool not found'), { status: 404 });
  if (tool.status !== 'enabled') throw Object.assign(new Error(`Tool ${tool.name} is not enabled`), { status: 403 });
  if (!context.authenticated) throw Object.assign(new Error('Authentication required'), { status: 401 });
  if (tool.riskLevel === 'high' && context.confirmed !== true) throw Object.assign(new Error('Explicit confirmation required for high-risk tool'), { status: 403 });
  return true;
}

export function verifyToolResult(result) {
  if (!result || typeof result !== 'object') return { valid: false, reason: 'invalid result' };
  if (result.error) return { valid: false, reason: String(result.error).slice(0, 500) };
  return { valid: true };
}

export const SAFETY_POLICY = Object.freeze({
  hierarchy: ['system', 'developer', 'user', 'trusted_tool', 'retrieved_knowledge', 'untrusted_web'],
  retrievedContentIsData: true,
  secretsRedaction: true,
  highRiskConfirmation: true,
  auditRequired: true,
});

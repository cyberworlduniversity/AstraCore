const SHA256 = /^[a-f0-9]{64}$/i;

function validateBaseUrl(value) {
  if (!value) return null;
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('ASTRACORE_LM_URL must be a valid absolute URL'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('AstraCoreLM remote runtime must use HTTPS; HTTP is allowed only on loopback');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw new Error('ASTRACORE_LM_URL must be an origin URL without credentials, path, query or fragment');
  }
  return parsed.origin;
}

export function createAstraCoreLMClient({
  url = '',
  token = '',
  expectedCheckpointSha256 = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
} = {}) {
  const baseUrl = validateBaseUrl(url);
  const configured = Boolean(baseUrl || token || expectedCheckpointSha256);
  if (configured && (!baseUrl || typeof token !== 'string' || token.length < 32 || !SHA256.test(expectedCheckpointSha256))) {
    throw new Error('AstraCoreLM requires URL, a 32-character token, and an exact approved checkpoint SHA-256');
  }
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  let verified = null;

  async function request(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(baseUrl + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`AstraCoreLM runtime returned HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function refresh() {
    if (!configured) return { configured: false, ready: false, reason: 'not_configured' };
    try {
      const health = await request('/health');
      const valid = health?.ok === true
        && health?.model_version === 'astracorelm-v0.2'
        && health?.production_approved === true
        && health?.checkpoint_sha256 === expectedCheckpointSha256;
      verified = valid ? {
        ready: true,
        model_version: health.model_version,
        checkpoint_sha256: health.checkpoint_sha256,
        production_approved: true,
        runtime: health.runtime || 'remote',
      } : null;
      return verified || { configured: true, ready: false, reason: 'approval_or_checkpoint_mismatch' };
    } catch {
      verified = null;
      return { configured: true, ready: false, reason: 'runtime_unavailable' };
    }
  }

  async function generate(prompt, { maxNewTokens = 48 } = {}) {
    if (!verified?.ready) {
      const state = await refresh();
      if (!state.ready) throw Object.assign(new Error('AstraCoreLM v0.2 is not independently approved and available'), { status: 503 });
    }
    const result = await request('/v1/generate', { prompt, max_new_tokens: maxNewTokens });
    if (result?.production_approved !== true
      || result?.model_version !== 'astracorelm-v0.2'
      || result?.checkpoint_sha256 !== expectedCheckpointSha256
      || typeof result?.text !== 'string'
      || !Number.isInteger(result?.tokens_generated)
      || result.tokens_generated < 0) {
      verified = null;
      throw Object.assign(new Error('AstraCoreLM inference response failed integrity checks'), { status: 503 });
    }
    return result;
  }

  return {
    configured,
    refresh,
    generate,
    status: () => verified || { configured, ready: false, reason: configured ? 'not_verified' : 'not_configured' },
  };
}

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'scripts', 'embed_text.py');
const CHECKPOINT = process.env.ASTRACORE_EMBED_CHECKPOINT || join(HERE, '..', 'data', 'checkpoints', 'astracore-embed-v0.1');
const DIMENSIONS = 384;
const MAX_TEXTS = 64;
const MAX_TEXT_CHARS = 8000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

function validateRemoteUrl(value) {
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('ASTRACORE_EMBEDDING_URL must be a valid absolute URL');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:')) {
    throw new Error('Remote AstraCoreEmbed requires HTTPS; HTTP is allowed only on loopback');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw new Error('ASTRACORE_EMBEDDING_URL must be an origin URL without credentials, path, query or fragment');
  }
  return parsed.origin;
}

function validateVectors(payload, expectedCount) {
  if (payload?.ok !== true || payload?.dimensions !== DIMENSIONS
    || !Array.isArray(payload?.embeddings) || payload.embeddings.length !== expectedCount) return null;
  const vectors = payload.embeddings;
  if (vectors.some((vector) => !Array.isArray(vector)
    || vector.length !== DIMENSIONS
    || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value)))) return null;
  return vectors;
}

function normalizeTexts(texts) {
  if (!Array.isArray(texts) || texts.length > MAX_TEXTS) return null;
  const input = texts.map((value) => String(value).slice(0, MAX_TEXT_CHARS));
  return input.length ? input : [];
}

function createRemoteEmbedder({ baseUrl, token, fetchImpl, timeoutMs }) {
  return async function embedRemote(texts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(baseUrl + '/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ texts }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      return validateVectors(await response.json(), texts.length);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

function createLocalEmbedder({ checkpoint, timeoutMs }) {
  return async function embedLocal(texts) {
    return new Promise((resolve) => {
      const executable = process.platform === 'win32' ? 'python' : 'python3';
      let child;
      try {
        child = spawn(executable, [SCRIPT], {
          stdio: ['pipe', 'pipe', 'ignore'],
          windowsHide: true,
        });
      } catch {
        resolve(null);
        return;
      }
      let output = '';
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(null);
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
        if (Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES) {
          child.kill('SIGKILL');
          finish(null);
        }
      });
      child.on('error', () => finish(null));
      child.on('close', (code) => {
        if (settled) return;
        try {
          const payload = JSON.parse(output);
          finish(code === 0 ? validateVectors(payload, texts.length) : null);
        } catch {
          finish(null);
        }
      });
      child.stdin.on('error', () => finish(null));
      child.stdin.end(JSON.stringify({ checkpoint, texts }));
    });
  };
}

/**
 * Uses the self-hosted AstraCoreEmbed HTTP endpoint when configured (required
 * for Vercel/serverless deployments), otherwise the local Python checkpoint.
 * No third-party embedding provider is used.
 */
export function createEmbeddingService({
  url = process.env.ASTRACORE_EMBEDDING_URL || '',
  token = process.env.ASTRACORE_EMBEDDING_TOKEN || '',
  fetchImpl = globalThis.fetch,
  checkpoint = CHECKPOINT,
  timeoutMs = 30_000,
} = {}) {
  const baseUrl = validateRemoteUrl(url);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000) {
    throw new Error('Embedding timeout must be between 1000 and 60000 milliseconds');
  }
  if (baseUrl && (typeof token !== 'string' || token.length < 32)) {
    throw new Error('AstraCoreEmbed remote serving requires a server-only token of at least 32 characters');
  }
  if (baseUrl && typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for remote AstraCoreEmbed');
  }
  const embed = baseUrl
    ? createRemoteEmbedder({ baseUrl, token, fetchImpl, timeoutMs })
    : createLocalEmbedder({ checkpoint, timeoutMs });

  return async function embedTexts(texts) {
    const input = normalizeTexts(texts);
    if (input === null) return null;
    if (!input.length) return [];
    return embed(input);
  };
}

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { redactSecrets, classifyUntrustedText } from './safety-layer.js';

const MAX_RESPONSE_CHARS = 10000;
const DEFAULT_TIMEOUT_MS = 12000;

function ipv4ToParts(address) {
  return address.split('.').map(Number);
}

function isPublicIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = ipv4ToParts(address);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168 || (b === 0 && c === 2))) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIPv6(address) {
  if (isIP(address) !== 6) return false;
  const value = address.toLowerCase();
  // Only global-unicast 2000::/3 is accepted. This excludes loopback,
  // link-local, unique-local, multicast, IPv4-mapped and unspecified ranges.
  if (!/^(2[0-9a-f]{3}|3[0-9a-f]{3}):/.test(value)) return false;
  if (value.startsWith('2001:db8:')) return false;
  return true;
}

function isPublicAddress(address) {
  return isIP(address) === 4 ? isPublicIPv4(address) : isPublicIPv6(address);
}

export async function validateResearchUrl(value, { resolveHost = lookup } = {}) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, reason: 'unsupported_protocol' };
  if (url.username || url.password) return { ok: false, reason: 'url_credentials_not_allowed' };
  if (!url.hostname || url.hostname.endsWith('.localhost') || url.hostname === 'localhost') {
    return { ok: false, reason: 'local_hostname_not_allowed' };
  }
  if (url.port && !['80', '443'].includes(url.port)) return { ok: false, reason: 'nonstandard_port_not_allowed' };

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) return { ok: false, reason: 'non_public_address_not_allowed' };
    return { ok: true, url: url.href, hostname, addresses: [hostname] };
  }

  let records;
  try {
    records = await resolveHost(hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: 'hostname_resolution_failed' };
  }
  const addresses = [...new Set((Array.isArray(records) ? records : [records]).map((record) => typeof record === 'string' ? record : record?.address).filter(Boolean))];
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) {
    return { ok: false, reason: 'hostname_resolves_to_non_public_address' };
  }
  return { ok: true, url: url.href, hostname, addresses };
}

export function createResearchPlan(question, { maxSources = 8 } = {}) {
  return {
    question: String(question ?? '').slice(0, 4000),
    stages: ['search', 'validate_url', 'fetch_no_redirect', 'extract', 'verify', 'rank', 'cite', 'synthesize'],
    maxSources: Math.min(Math.max(Number(maxSources) || 8, 1), 20),
  };
}

export async function runResearch(question, adapters = {}, options = {}) {
  const plan = createResearchPlan(question, options);
  if (typeof adapters.search !== 'function' || typeof adapters.fetchSafe !== 'function') {
    return { status: 'not_implemented', plan, sources: [], rejected: [], answer: null };
  }

  const resolveHost = options.resolveHost || lookup;
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), 30000);
  const searchResults = await adapters.search(plan.question, { limit: plan.maxSources });
  const candidates = Array.isArray(searchResults) ? searchResults.slice(0, plan.maxSources) : [];
  const checked = await Promise.all(candidates.map(async (candidate, index) => {
    const validation = await validateResearchUrl(candidate?.url, { resolveHost });
    return { candidate, index, validation };
  }));

  const accepted = checked.filter((item) => item.validation.ok);
  const rejected = checked.filter((item) => !item.validation.ok).map(({ candidate, validation }) => ({
    url: String(candidate?.url || '').slice(0, 1000),
    reason: validation.reason,
  }));

  const fetched = await Promise.all(accepted.map(async ({ candidate, index, validation }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('research_fetch_timeout')), timeoutMs);
    try {
      // The adapter contract is manual redirects only. Redirects are rejected;
      // adapters must pin connections to validation.addresses to prevent DNS rebinding.
      const item = await Promise.race([
        Promise.resolve(adapters.fetchSafe(validation.url, {
          redirect: 'manual',
          maxRedirects: 0,
          signal: controller.signal,
          timeoutMs,
          resolvedAddresses: validation.addresses,
        })),
        new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('research_fetch_timeout')), { once: true });
        }),
      ]);
      const status = Number(item?.status || item?.statusCode || 200);
      const returnedUrl = item?.url ? new URL(item.url, validation.url).href : validation.url;
      if ((status >= 300 && status < 400) || item?.redirected === true || returnedUrl !== validation.url) {
        return { index, url: validation.url, error: 'redirect_blocked' };
      }
      if (status < 200 || status >= 300) return { index, url: validation.url, error: 'upstream_http_error' };
      const content = redactSecrets(String(item?.content || '').slice(0, MAX_RESPONSE_CHARS));
      if (!content.trim()) return { index, url: validation.url, error: 'empty_content' };
      return {
        index,
        source: {
          source_id: String(item?.id || `web-${index + 1}`).slice(0, 128),
          title: String(item?.title || candidate?.title || 'Web source').slice(0, 300),
          url: validation.url,
          content,
          trust: 'untrusted',
          injection_risk: classifyUntrustedText(content).injectionRisk,
        },
      };
    } catch (error) {
      return { index, url: validation.url, error: error instanceof Error && error.message === 'research_fetch_timeout' ? 'fetch_timeout' : 'fetch_failed' };
    } finally {
      clearTimeout(timer);
    }
  }));

  const sources = fetched.filter((item) => item.source).map((item) => item.source);
  rejected.push(...fetched.filter((item) => item.error).map((item) => ({
    url: String(item.url || '').slice(0, 1000),
    reason: item.error,
  })));
  return { status: sources.length ? 'retrieved' : 'blocked', plan, sources, rejected, answer: null };
}

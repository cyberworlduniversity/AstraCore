const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function requestHost(req) {
  return String(req.headers?.host || '').trim().toLowerCase();
}

function requestProtocol(req) {
  const forwarded = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (forwarded === 'http' || forwarded === 'https') return forwarded;
  return req.socket?.encrypted ? 'https' : 'http';
}

/**
 * Reject cross-origin browser requests for state-changing endpoints.
 * Native/server clients that omit Origin and Fetch Metadata remain compatible;
 * browsers that send either header are checked strictly against the request host.
 */
export function isSameOriginRequest(req) {
  if (SAFE_METHODS.has(String(req.method || 'GET').toUpperCase())) return true;

  const originHeader = req.headers?.origin;
  const refererHeader = req.headers?.referer;
  const source = originHeader || refererHeader;

  if (!source) {
    return String(req.headers?.['sec-fetch-site'] || '').toLowerCase() !== 'cross-site';
  }

  const host = requestHost(req);
  if (!host) return false;

  try {
    const sourceUrl = new URL(String(source));
    if (sourceUrl.username || sourceUrl.password) return false;
    return sourceUrl.host.toLowerCase() === host &&
      sourceUrl.protocol === requestProtocol(req) + ':';
  } catch {
    return false;
  }
}

export function rejectCrossOriginRequest(req, res) {
  if (isSameOriginRequest(req)) return false;
  res.statusCode = 403;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('vary', 'Origin, Referer, Sec-Fetch-Site');
  res.end(JSON.stringify({ error: 'Cross-origin request blocked.' }));
  return true;
}

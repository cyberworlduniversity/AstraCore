import { clearSessionCookie, revokeSession } from '../../server/auth.js';
import { rejectCrossOriginRequest } from '../../server/csrf.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('allow', 'POST');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  if (rejectCrossOriginRequest(req, res)) return;
  try {
    await revokeSession(req);
  } catch {
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('set-cookie', clearSessionCookie());
    return res.end(JSON.stringify({ error: 'Session revocation is temporarily unavailable. Please sign in again after the service recovers.' }));
  }
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('set-cookie', clearSessionCookie());
  return res.end(JSON.stringify({ ok: true }));
}

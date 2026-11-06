import { signup, sessionCookie } from '../../server/auth.js';
import { rejectCrossOriginRequest } from '../../server/csrf.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('allow', 'POST');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  if (rejectCrossOriginRequest(req, res)) return;
  try {
    const body = typeof req.body === 'object' && req.body ? req.body : {};
    const result = await signup(body.email, body.password, body.name);
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');

    // Email-confirmation signups have an account but no authenticated session yet.
    // Never mint a session cookie from a missing token.
    if (!result.token) {
      if (result.verificationRequired && result.user) {
        res.statusCode = 202;
        return res.end(JSON.stringify({
          user: result.user,
          authenticated: false,
          verificationRequired: true,
        }));
      }
      res.statusCode = 502;
      return res.end(JSON.stringify({
        error: 'Signup did not return a usable session. Please try again.',
      }));
    }

    res.statusCode = 201;
    res.setHeader('set-cookie', sessionCookie(result.token));
    return res.end(JSON.stringify({ user: result.user, authenticated: true }));
  } catch (error) {
    const status = Number(error.status) || 500;
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return res.end(JSON.stringify({ error: status === 500 ? 'Internal server error' : error.message }));
  }
}

import { signup, sessionCookie } from '../../server/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('allow', 'POST');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  try {
    const body = typeof req.body === 'object' && req.body ? req.body : {};
    const result = await signup(body.email, body.password, body.name);
    res.statusCode = 201;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('set-cookie', sessionCookie(result.token));
    return res.end(JSON.stringify({ user: result.user }));
  } catch (error) {
    const status = Number(error.status) || 500;
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return res.end(JSON.stringify({ error: status === 500 ? 'Internal server error' : error.message }));
  }
}

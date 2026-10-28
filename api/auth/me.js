import { currentUser, isAdmin } from '../../server/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  try {
    const user = await currentUser(req);
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return res.end(JSON.stringify({
      authenticated: Boolean(user),
      user: user ? { id: user.id, email: user.email, name: user.name, provider: user.provider, isAdmin: isAdmin(user) } : null
    }));
  } catch {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ authenticated: false, user: null }));
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ASTRA_SESSION_SECRET = 'test-only-session-secret-with-sufficient-entropy';
process.env.ASTRACORE_SUPABASE_URL = 'https://supabase.example.test';
process.env.ASTRACORE_SUPABASE_KEY = 'test-anon-key';
process.env.NODE_ENV = 'test';

const auth = await import('../server/auth.js');
const { default: logoutHandler } = await import('../api/auth/logout.js');
const { default: meHandler } = await import('../api/auth/me.js');

function responseCapture() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = value; },
  };
}

test('Vercel logout revokes the upstream Supabase session and clears the cookie', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(null, { status: 204 });
  };
  try {
    const token = auth.createSessionToken('access-token-a', 'refresh-token-a', { id: 'user-a', email: 'a@example.test' });
    const req = { method: 'POST', headers: { cookie: 'astracore_session=' + encodeURIComponent(token) } };
    const res = responseCapture();
    await logoutHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['set-cookie'], /Max-Age=0/);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/auth\/v1\/logout$/);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer access-token-a');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('logout refreshes an expired access token before revoking the session', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/logout') && options.headers?.Authorization === 'Bearer expired-access') {
      return new Response(JSON.stringify({ message: 'JWT expired' }), { status: 401 });
    }
    if (String(url).includes('/auth/v1/token?grant_type=refresh_token')) {
      return new Response(JSON.stringify({
        access_token: 'fresh-access',
        refresh_token: 'fresh-refresh',
        expires_in: 3600,
        user: { id: 'user-a', email: 'a@example.test', user_metadata: {}, app_metadata: { provider: 'password' } },
      }), { status: 200 });
    }
    if (String(url).endsWith('/auth/v1/logout') && options.headers?.Authorization === 'Bearer fresh-access') {
      return new Response(null, { status: 204 });
    }
    throw new Error('Unexpected auth request');
  };
  try {
    const token = auth.createSessionToken('expired-access', 'refresh-token-a', { id: 'user-a', email: 'a@example.test' });
    const req = { method: 'POST', headers: { cookie: 'astracore_session=' + encodeURIComponent(token) } };
    const res = responseCapture();
    await logoutHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls.map((call) => call.url.split('/').pop()), ['logout', 'token?grant_type=refresh_token', 'logout']);
    assert.equal(calls[2].options.headers.Authorization, 'Bearer fresh-access');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('auth/me persists the rotated cookie after refreshing an expired access token', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ message: 'JWT expired' }), { status: 401 });
    }
    if (String(url).includes('/auth/v1/token?grant_type=refresh_token')) {
      return new Response(JSON.stringify({
        access_token: 'rotated-access',
        refresh_token: 'rotated-refresh',
        expires_in: 3600,
        user: { id: 'user-a', email: 'a@example.test', user_metadata: {}, app_metadata: { provider: 'password' } },
      }), { status: 200 });
    }
    throw new Error('Unexpected auth request');
  };
  try {
    const token = auth.createSessionToken('expired-access', 'old-refresh', { id: 'user-a', email: 'a@example.test' });
    const req = { method: 'GET', headers: { cookie: 'astracore_session=' + encodeURIComponent(token) } };
    const res = responseCapture();
    await meHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).authenticated, true);
    assert.ok(res.headers['set-cookie']?.startsWith('astracore_session='));
    assert.notEqual(res.headers['set-cookie'], auth.sessionCookie(token));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

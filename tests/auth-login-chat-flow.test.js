import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ASTRA_SESSION_SECRET = 'test-only-session-secret-with-sufficient-entropy';
process.env.ASTRACORE_SUPABASE_URL = 'https://supabase.example.test';
process.env.ASTRACORE_SUPABASE_KEY = 'test-anon-key';
process.env.NODE_ENV = 'test';

const { default: loginHandler } = await import('../api/auth/login.js');
const { default: meHandler } = await import('../api/auth/me.js');
const { default: logoutHandler } = await import('../api/auth/logout.js');
const { default: apiHandler } = await import('../api/[...path].js');

function responseCapture() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = value; },
  };
}

const supabaseUser = {
  id: 'auth-user-a',
  email: 'user-a@example.test',
  user_metadata: { name: 'User A' },
  app_metadata: { provider: 'password' },
};

function cookieFrom(res) {
  assert.ok(res.headers['set-cookie'], 'login should set a session cookie');
  return res.headers['set-cookie'].split(';')[0];
}

test('login -> auth/me -> protected chat workspace API -> logout -> protected API denial', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const revokedSessionHashes = new Set();
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, options });
    if (target.includes('/auth/v1/token?grant_type=password')) {
      return new Response(JSON.stringify({
        access_token: 'access-token-a',
        refresh_token: 'refresh-token-a',
        expires_in: 3600,
        user: supabaseUser,
      }), { status: 200 });
    }
    if (target.includes('/rest/v1/astracore_revoked_sessions')) {
      if (options.method === 'POST') {
        const row = JSON.parse(options.body);
        assert.equal(row.user_id, 'auth-user-a');
        revokedSessionHashes.add(row.session_hash);
        return new Response(null, { status: 201 });
      }
      const hash = new URL(target).searchParams.get('session_hash')?.replace(/^eq\./, '');
      return new Response(JSON.stringify(revokedSessionHashes.has(hash) ? [{ session_hash: hash }] : []), { status: 200 });
    }
    if (target.endsWith('/auth/v1/user')) {
      assert.equal(options.headers.Authorization, 'Bearer access-token-a');
      return new Response(JSON.stringify(supabaseUser), { status: 200 });
    }
    if (target.includes('/rest/v1/astracore_conversations?')) {
      assert.equal(options.headers.Authorization, 'Bearer access-token-a');
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (target.endsWith('/auth/v1/logout')) {
      assert.equal(options.headers.Authorization, 'Bearer access-token-a');
      return new Response(null, { status: 204 });
    }
    throw new Error('Unexpected Supabase request: ' + target);
  };

  try {
    const loginRes = responseCapture();
    await loginHandler({
      method: 'POST',
      body: { email: ' USER-A@EXAMPLE.TEST ', password: 'correct-horse-battery-staple' },
      headers: {},
    }, loginRes);

    assert.equal(loginRes.statusCode, 200);
    assert.equal(JSON.parse(loginRes.body).user.id, 'auth-user-a');
    assert.match(loginRes.headers['set-cookie'], /HttpOnly/);
    assert.match(loginRes.headers['set-cookie'], /SameSite=Lax/);
    const cookie = cookieFrom(loginRes);

    const meRes = responseCapture();
    await meHandler({ method: 'GET', headers: { cookie } }, meRes);
    assert.equal(meRes.statusCode, 200);
    assert.equal(JSON.parse(meRes.body).authenticated, true);
    assert.equal(JSON.parse(meRes.body).user.id, 'auth-user-a');

    const workspaceRes = responseCapture();
    await apiHandler({ method: 'GET', url: '/api/conversations', headers: { cookie } }, workspaceRes);
    assert.equal(workspaceRes.statusCode, 200);
    assert.deepEqual(JSON.parse(workspaceRes.body).conversations, []);

    const logoutRes = responseCapture();
    await logoutHandler({ method: 'POST', headers: { cookie } }, logoutRes);
    assert.equal(logoutRes.statusCode, 200);
    assert.deepEqual(JSON.parse(logoutRes.body), { ok: true });
    assert.match(logoutRes.headers['set-cookie'], /Max-Age=0/);

    // Replaying the exact pre-logout cookie must fail even while its Supabase access JWT is otherwise valid.
    const replayRes = responseCapture();
    await apiHandler({ method: 'GET', url: '/api/conversations', headers: { cookie } }, replayRes);
    assert.equal(replayRes.statusCode, 401);
    assert.match(JSON.parse(replayRes.body).error, /Login required/);

    const noCookieRes = responseCapture();
    await apiHandler({ method: 'GET', url: '/api/conversations', headers: {} }, noCookieRes);
    assert.equal(noCookieRes.statusCode, 401);

    assert.equal(calls.filter((call) => call.url.includes('/auth/v1/token?grant_type=password')).length, 1);
    assert.equal(calls.filter((call) => call.url.endsWith('/auth/v1/logout')).length, 1);
    assert.equal(calls.filter((call) => call.url.includes('/rest/v1/astracore_revoked_sessions') && call.options.method === 'POST').length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

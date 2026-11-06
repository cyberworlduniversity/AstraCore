import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.ASTRA_SESSION_SECRET = 'test-only-session-secret-with-sufficient-entropy';
process.env.ASTRACORE_SUPABASE_URL = 'https://supabase.example.test';
process.env.ASTRACORE_SUPABASE_KEY = 'test-anon-key';
process.env.NODE_ENV = 'test';

const { default: loginHandler } = await import('../api/auth/login.js');
const { default: meHandler } = await import('../api/auth/me.js');
const { default: logoutHandler } = await import('../api/auth/logout.js');
const { default: apiHandler } = await import('../api/[...path].js');
const { createSessionToken, sessionCookie } = await import('../server/auth.js');

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
        const rows = JSON.parse(options.body);
        assert.equal(rows.length, 2);
        for (const row of rows) {
          assert.equal(row.user_id, 'auth-user-a');
          revokedSessionHashes.add(row.session_hash);
        }
        return new Response(null, { status: 201 });
      }
      const hashes = new URL(target).searchParams.get('session_hash')?.match(/[a-f0-9]{64}/g) || [];
      const matches = hashes.filter((hash) => revokedSessionHashes.has(hash)).map((session_hash) => ({ session_hash }));
      return new Response(JSON.stringify(matches), { status: 200 });
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


test('expired access session refreshes before revocation lookup and continues to protected API', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const cookie = sessionCookie(createSessionToken(
    'expired-access-token',
    'valid-refresh-token',
    supabaseUser,
    0,
    Date.now() + 60 * 60 * 1000,
  )).split(';')[0];

  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target.includes('/auth/v1/token?grant_type=refresh_token')) {
      assert.deepEqual(JSON.parse(options.body), { refresh_token: 'valid-refresh-token' });
      return new Response(JSON.stringify({
        access_token: 'fresh-access-token',
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
        user: supabaseUser,
      }), { status: 200 });
    }
    if (target.includes('/rest/v1/astracore_revoked_sessions')) {
      assert.equal(options.headers.Authorization, 'Bearer fresh-access-token');
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (target.includes('/rest/v1/astracore_conversations?')) {
      assert.equal(options.headers.Authorization, 'Bearer fresh-access-token');
      return new Response(JSON.stringify([]), { status: 200 });
    }
    throw new Error('Unexpected Supabase request: ' + target);
  };

  try {
    const response = responseCapture();
    await apiHandler({ method: 'GET', url: '/api/conversations', headers: { cookie } }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body).conversations, []);
    assert.ok(calls.findIndex((call) => call.target.includes('grant_type=refresh_token')) <
      calls.findIndex((call) => call.target.includes('astracore_revoked_sessions')));
    assert.ok(response.headers['set-cookie'], 'refreshed session cookie should be returned');
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('revoked refresh-token hash blocks replay after access-token refresh', async () => {
  const originalFetch = globalThis.fetch;
  const refreshToken = 'revoked-refresh-token';
  const refreshHash = createHash('sha256').update(refreshToken).digest('hex');
  const cookie = sessionCookie(createSessionToken(
    'expired-access-token',
    refreshToken,
    supabaseUser,
    0,
    Date.now() + 60 * 60 * 1000,
  )).split(';')[0];

  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/auth/v1/token?grant_type=refresh_token')) {
      return new Response(JSON.stringify({
        access_token: 'fresh-access-token-after-logout',
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
        user: supabaseUser,
      }), { status: 200 });
    }
    if (target.includes('/rest/v1/astracore_revoked_sessions')) {
      assert.ok(target.includes(refreshHash), 'lookup must include the old refresh-token hash');
      return new Response(JSON.stringify([{ session_hash: refreshHash }]), { status: 200 });
    }
    throw new Error('Unexpected Supabase request: ' + target);
  };

  try {
    const response = responseCapture();
    await apiHandler({ method: 'GET', url: '/api/conversations', headers: { cookie } }, response);
    assert.equal(response.statusCode, 401);
    assert.match(JSON.parse(response.body).error, /Login required/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

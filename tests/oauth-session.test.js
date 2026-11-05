import test, { after } from 'node:test';
import assert from 'node:assert/strict';

process.env.ASTRACORE_SUPABASE_URL = 'https://astracore-test.supabase.co';
process.env.ASTRACORE_SUPABASE_KEY = 'test-publishable-key';
process.env.ASTRA_SESSION_SECRET = 'oauth-session-test-secret';

const originalFetch = globalThis.fetch;
const auth = await import('../server/auth.js?oauth-pkce-test');

after(() => {
  globalThis.fetch = originalFetch;
});

function requestFor(flow) {
  const cookie = flow.cookie.match(/^astracore_oauth=([^;]+)/)?.[1];
  assert.ok(cookie, 'OAuth state cookie should be present');
  return { headers: { cookie: `astracore_oauth=${cookie}` } };
}

test('OAuth start uses PKCE, random state and a short-lived HttpOnly cookie', () => {
  const flow = auth.oauthStart('google');
  const url = new URL(flow.url);

  assert.equal(url.searchParams.get('provider'), 'google');
  assert.equal(url.searchParams.get('redirect_to'), 'http://127.0.0.1:8787/');
  assert.equal(url.searchParams.get('code_challenge_method'), 's256');
  assert.match(url.searchParams.get('code_challenge') || '', /^[A-Za-z0-9_-]{43}$/);
  assert.match(url.searchParams.get('state') || '', /^[A-Za-z0-9_-]{43}$/);
  assert.match(flow.cookie, /HttpOnly/);
  assert.match(flow.cookie, /SameSite=Lax/);
  assert.match(flow.cookie, /Max-Age=600/);
});

test('OAuth code exchange validates state and exchanges the PKCE verifier with Supabase', async () => {
  const flow = auth.oauthStart('github');
  const state = new URL(flow.url).searchParams.get('state');
  let request;

  globalThis.fetch = async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      access_token: 'verified-access-token',
      refresh_token: 'verified-refresh-token',
      expires_in: 3600,
      user: {
        id: 'user-123',
        email: 'person@example.com',
        user_metadata: { name: 'Test User' },
        app_metadata: { provider: 'github' },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await auth.exchangeOAuthCode('one-time-auth-code', state, requestFor(flow));

  assert.equal(request.url, 'https://astracore-test.supabase.co/auth/v1/token?grant_type=pkce');
  assert.equal(request.body.auth_code, 'one-time-auth-code');
  assert.match(request.body.code_verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.user.id, 'user-123');
  assert.equal(result.user.provider, 'github');
  assert.ok(result.token);
});

test('OAuth code exchange rejects a mismatched state before contacting Supabase', async () => {
  const flow = auth.oauthStart('google');
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('fetch should not be called');
  };

  await assert.rejects(
    auth.exchangeOAuthCode('one-time-auth-code', 'wrong-state', requestFor(flow)),
    (error) => error.status === 401,
  );
  assert.equal(called, false);
});

test('OAuth code exchange rejects expired or missing state cookies', async () => {
  await assert.rejects(
    auth.exchangeOAuthCode('one-time-auth-code', 'some-state', { headers: { cookie: '' } }),
    (error) => error.status === 401,
  );
  assert.match(auth.clearOAuthCookie(), /Max-Age=0/);
});

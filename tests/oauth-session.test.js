import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

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
  assert.equal(new URL(flow.url).searchParams.get('code_challenge'), createHash('sha256').update(request.body.code_verifier).digest('base64url'));
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

test('expired access tokens can be refreshed while the signed session cookie remains valid', async () => {
  const flow = auth.oauthStart('google');
  const state = new URL(flow.url).searchParams.get('state');
  const originalNow = Date.now;
  const user = {
    id: 'user-refresh',
    email: 'refresh@example.com',
    user_metadata: { name: 'Refresh User' },
    app_metadata: { provider: 'google' },
  };

  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith('/auth/v1/token?grant_type=pkce')) {
      return new Response(JSON.stringify({
        access_token: 'old-access-token',
        refresh_token: 'old-refresh-token',
        expires_in: 60,
        user,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (value.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ message: 'JWT expired' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (value.endsWith('/auth/v1/token?grant_type=refresh_token')) {
      return new Response(JSON.stringify({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        user,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected auth request: ${value}`);
  };

  try {
    const result = await auth.exchangeOAuthCode('one-time-auth-code', state, requestFor(flow));
    const cookie = auth.sessionCookie(result.token).split(';')[0];
    Date.now = () => originalNow() + 120_000;

    const req = { headers: { cookie } };
    const current = await auth.currentUser(req);

    assert.equal(current.id, 'user-refresh');
    assert.ok(req.astracoreRefreshedSession);
    assert.equal(req.astracoreAccessToken, 'new-access-token');
  } finally {
    Date.now = originalNow;
  }
});

test('OAuth redirects use the active Vercel deployment URL when no public URL override exists', async () => {
  const previousPublicUrl = process.env.ASTRA_PUBLIC_URL;
  const previousVercelUrl = process.env.VERCEL_URL;
  delete process.env.ASTRA_PUBLIC_URL;
  process.env.VERCEL_URL = 'astracore-preview.example.vercel.app';

  try {
    const previewAuth = await import('../server/auth.js?oauth-preview-url');
    const flow = previewAuth.oauthStart('google');
    assert.equal(new URL(flow.url).searchParams.get('redirect_to'), 'https://astracore-preview.example.vercel.app/');
  } finally {
    if (previousPublicUrl === undefined) delete process.env.ASTRA_PUBLIC_URL;
    else process.env.ASTRA_PUBLIC_URL = previousPublicUrl;
    if (previousVercelUrl === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = previousVercelUrl;
  }
});


test('tampered signed OAuth session cookies are rejected before Supabase access', async () => {
  const flow = auth.oauthStart('google');
  const state = new URL(flow.url).searchParams.get('state');
  const original = flow.cookie.match(/^astracore_oauth=([^;]+)/)?.[1];
  assert.ok(original);
  const last = original.at(-1);
  const tampered = original.slice(0, -1) + (last === 'a' ? 'b' : 'a');
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('Supabase must not be called for a tampered session');
  };

  await assert.rejects(
    auth.exchangeOAuthCode('one-time-auth-code', state, { headers: { cookie: `astracore_oauth=${tampered}` } }),
    (error) => error.status === 401,
  );
  assert.equal(called, false);
});
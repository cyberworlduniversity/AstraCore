import test, { after } from 'node:test';
import assert from 'node:assert/strict';

process.env.ASTRACORE_SUPABASE_URL = 'https://astracore-test.supabase.co';
process.env.ASTRACORE_SUPABASE_KEY = 'test-publishable-key';
process.env.ASTRA_SESSION_SECRET = 'oauth-session-test-secret';

const originalFetch = globalThis.fetch;
const auth = await import('../server/auth.js?oauth-session-test');

after(() => {
  globalThis.fetch = originalFetch;
});

test('OAuth session creation verifies the access token with Supabase', async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), authorization: options.headers.Authorization };
    return new Response(JSON.stringify({
      id: 'user-123',
      email: 'person@example.com',
      user_metadata: { name: 'Test User' },
      app_metadata: { provider: 'google' },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await auth.createOAuthSession('valid-access-token', 'valid-refresh-token', 3600);

  assert.equal(request.url, 'https://astracore-test.supabase.co/auth/v1/user');
  assert.equal(request.authorization, 'Bearer valid-access-token');
  assert.equal(result.user.id, 'user-123');
  assert.equal(result.user.provider, 'google');
  assert.ok(result.token);
});

test('OAuth session creation rejects missing or oversized tokens before network access', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('fetch should not be called');
  };

  await assert.rejects(
    auth.createOAuthSession('', 'refresh-token'),
    (error) => error.status === 400,
  );
  await assert.rejects(
    auth.createOAuthSession('a'.repeat(8193), 'refresh-token'),
    (error) => error.status === 400,
  );
  assert.equal(called, false);
});

test('OAuth session creation rejects tokens Supabase does not validate', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    message: 'Invalid JWT',
  }), { status: 401, headers: { 'content-type': 'application/json' } });

  await assert.rejects(
    auth.createOAuthSession('invalid-access-token', 'refresh-token'),
    (error) => error.status === 401,
  );
});

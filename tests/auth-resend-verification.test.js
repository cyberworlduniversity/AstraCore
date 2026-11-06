import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ASTRA_SESSION_SECRET = 'test-only-session-secret-with-sufficient-entropy';
process.env.ASTRACORE_SUPABASE_URL = 'https://supabase.example.test';
process.env.ASTRACORE_SUPABASE_KEY = 'test-anon-key';
process.env.NODE_ENV = 'test';

const { default: resendHandler } = await import('../api/auth/resend-verification.js');
const { login } = await import('../server/auth.js');

function responseCapture() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = value; },
  };
}

test('resend uses signup resend endpoint and does not create a session', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ message_id: 'test-message' }), { status: 200 });
  };
  try {
    const response = responseCapture();
    await resendHandler({ method: 'POST', headers: {}, body: { email: 'verify@example.test' } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['set-cookie'], undefined);
    assert.deepEqual(JSON.parse(response.body), { sent: true });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith('/auth/v1/resend'));
    assert.deepEqual(JSON.parse(calls[0].options.body), { email: 'verify@example.test', type: 'signup' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('signup OTP verification uses Supabase signup type', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options = {}) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({
      access_token: 'test-access',
      refresh_token: 'test-refresh',
      expires_in: 3600,
      user: { id: 'user-test', email: 'verify@example.test', user_metadata: {}, app_metadata: { provider: 'email' } },
    }), { status: 200 });
  };
  try {
    const result = await login('verify@example.test', '135790');
    assert.equal(result.user.email, 'verify@example.test');
    assert.ok(result.token);
    assert.ok(request.url.endsWith('/auth/v1/verify'));
    assert.deepEqual(JSON.parse(request.options.body), {
      email: 'verify@example.test', token: '135790', type: 'signup',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ASTRA_SESSION_SECRET = 'test-only-session-secret-with-sufficient-entropy';
process.env.ASTRACORE_SUPABASE_URL = 'https://supabase.example.test';
process.env.ASTRACORE_SUPABASE_KEY = 'test-anon-key';
process.env.NODE_ENV = 'test';

const { default: signupHandler } = await import('../api/auth/signup.js');

function responseCapture() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = value; },
  };
}

test('email-confirmation signup returns verification state without setting a session cookie', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const user = {
    id: 'auth-user-verification',
    email: 'verify@example.test',
    user_metadata: { name: 'Verify User' },
    app_metadata: { provider: 'email' },
  };

  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target.endsWith('/auth/v1/signup')) {
      return new Response(JSON.stringify({ user }), { status: 200 });
    }
    if (target.endsWith('/auth/v1/otp')) {
      return new Response(JSON.stringify({ message_id: 'verification-message' }), { status: 200 });
    }
    throw new Error('Unexpected Supabase request: ' + target);
  };

  try {
    const response = responseCapture();
    await signupHandler({
      method: 'POST',
      body: { email: 'verify@example.test', password: 'correct-horse-battery-staple', name: 'Verify User' },
      headers: {},
    }, response);

    assert.equal(response.statusCode, 202);
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(JSON.parse(response.body), {
      user: { id: 'auth-user-verification', email: 'verify@example.test', name: 'Verify User', provider: 'email', isAdmin: false },
      authenticated: false,
      verificationRequired: true,
    });
    assert.equal(calls.length, 2);
    assert.ok(calls.some((call) => call.target.endsWith('/auth/v1/otp')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

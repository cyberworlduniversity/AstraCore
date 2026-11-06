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
    assert.equal(calls.length, 1);
    assert.ok(calls[0].target.endsWith('/auth/v1/signup'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('six-digit signup verification uses the signup OTP endpoint and issues a session cookie', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const user = {
    id: 'auth-user-verified',
    email: 'verified@example.test',
    user_metadata: { name: 'Verified User' },
    app_metadata: { provider: 'email' },
  };

  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target.endsWith('/auth/v1/verify')) {
      return new Response(JSON.stringify({
        user,
        access_token: 'verified-access-token',
        refresh_token: 'verified-refresh-token',
        expires_in: 3600,
      }), { status: 200 });
    }
    throw new Error('Unexpected Supabase request: ' + target);
  };

  try {
    const { default: loginHandler } = await import('../api/auth/login.js');
    const response = responseCapture();
    await loginHandler({
      method: 'POST',
      body: { email: 'verified@example.test', password: '123456' },
      headers: {},
    }, response);

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['set-cookie'], /HttpOnly/i);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(JSON.parse(response.body), {
      user: {
        id: 'auth-user-verified',
        email: 'verified@example.test',
        name: 'Verified User',
        provider: 'email',
        isAdmin: false,
      },
    });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].target.endsWith('/auth/v1/verify'));
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      email: 'verified@example.test',
      token: '123456',
      type: 'signup',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

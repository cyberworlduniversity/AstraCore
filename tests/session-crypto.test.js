import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ASTRA_SESSION_SECRET = 'test-only-session-secret-with-sufficient-entropy';
const { createSessionToken, readSessionToken } = await import('../server/auth.js');

test('session token encrypts access and refresh tokens at rest in the browser cookie', () => {
  const accessToken = 'private-access-token-value';
  const refreshToken = 'private-refresh-token-value';
  const token = createSessionToken(accessToken, refreshToken, { id: 'user-1', email: 'user@example.test' }, 3600);
  assert.ok(token.startsWith('v2.'));
  assert.ok(!token.includes(accessToken));
  assert.ok(!token.includes(refreshToken));
  const decoded = readSessionToken(token);
  assert.equal(decoded.accessToken, accessToken);
  assert.equal(decoded.refreshToken, refreshToken);
  assert.equal(decoded.user.id, 'user-1');
});

test('tampered or malformed encrypted session cookies are rejected', () => {
  const token = createSessionToken('access', 'refresh', { id: 'user-1' }, 3600);
  const parts = token.split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  assert.equal(readSessionToken(parts.join('.')), null);
  assert.equal(readSessionToken('v2.not-valid'), null);
  assert.equal(readSessionToken(''), null);
});

test('expired access tokens remain eligible for refresh while the session is valid', () => {
  const token = createSessionToken('expired-access', 'refresh-token', { id: 'user-1' }, -120, Date.now() + 60_000);
  const decoded = readSessionToken(token);
  assert.ok(decoded);
  assert.ok(decoded.expiresAt < Date.now());
  assert.ok(decoded.sessionExpiresAt > Date.now());
});

test('expired session lifetime is rejected', () => {
  const token = createSessionToken('access', 'refresh', { id: 'user-1' }, 3600, Date.now() - 1);
  assert.equal(readSessionToken(token), null);
});

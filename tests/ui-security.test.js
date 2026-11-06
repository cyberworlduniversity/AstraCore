import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../web/auth.js', import.meta.url), 'utf8');
const authServer = readFileSync(new URL('../server/auth.js', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('chat submit handler has one valid error handler and always clears busy state', () => {
  assert.match(app, /catch\(e\)\{pending\.textContent=e\.status===401\?/);
  assert.match(app, /finally\{\$\('composer'\)\?\.classList\.remove\('busy'\)/);
  assert.doesNotMatch(app, /catch\(e\)\{pending\.textContent=e\.message\}catch\(e\)/);
});

test('successful password login and email verification return to the chat home', () => {
  assert.equal((auth.match(/window\.location\.replace\('\\/'\)/g) || []).length, 2);
  assert.match(auth, /astracore:auth-required/);
  assert.match(app, /astracore:auth-required/);
});

test('login dialog is accessible and references the real logo asset', () => {
  assert.match(auth, /aria-labelledby="authTitle" aria-describedby="authSub"/);
  assert.match(auth, /src="\/web\/assets\/astracore-logo\.svg"/);
  assert.equal(existsSync(new URL('../web/assets/astracore-logo.svg', import.meta.url)), true);
  assert.match(auth, /aria-label="Email address"/);
  assert.match(auth, /aria-label="Password"/);
});

test('CSP does not allow inline JavaScript', () => {
  const csp = vercel.headers.flatMap((item) => item.headers || [])
    .find((header) => header.key === 'Content-Security-Policy')?.value || '';
  assert.match(csp, /script-src 'self';/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
});

test('session cookie parser rejects malformed encodings and MAC comparison is constant-time', () => {
  assert.match(authServer, /timingSafeEqual/);
  assert.match(authServer, /try\{return decodeURIComponent\(v\.join\('\='\)\)\}catch\{return ''\}/);
  assert.match(authServer, /HttpOnly/);
  assert.match(authServer, /SameSite=Lax/);
});

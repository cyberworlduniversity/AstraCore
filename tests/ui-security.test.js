import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../web/auth.js', import.meta.url), 'utf8');
const authServer = readFileSync(new URL('../server/auth.js', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('chat submit handler has one valid error handler and always clears busy state', () => {
  assert.ok(app.includes("catch(e){pending.textContent=e.status===401?"));
  assert.ok(app.includes("finally{$('composer')?.classList.remove('busy')"));
  assert.ok(!app.includes("catch(e){pending.textContent=e.message}catch(e)"));
});

test('successful password login and email verification return to the chat home', () => {
  const redirect = "window.location.replace('/')"; 
  assert.equal(auth.split(redirect).length - 1, 2);
  assert.ok(auth.includes("astracore:auth-required"));
  assert.ok(app.includes("astracore:auth-required"));
});

test('login dialog is accessible and references the real logo asset', () => {
  assert.ok(auth.includes('aria-labelledby="authTitle" aria-describedby="authSub"'));
  assert.ok(auth.includes('src="/web/assets/astracore-logo.svg"'));
  assert.equal(existsSync(new URL('../web/assets/astracore-logo.svg', import.meta.url)), true);
  assert.ok(auth.includes('aria-label="Email address"'));
  assert.ok(auth.includes('aria-label="Password"'));
});

test('CSP does not allow inline JavaScript', () => {
  const csp = vercel.headers.flatMap((item) => item.headers || [])
    .find((header) => header.key === 'Content-Security-Policy')?.value || '';
  assert.ok(csp.includes("script-src 'self';"));
  assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes("object-src 'none'"));
});

test('session cookie parser rejects malformed encodings and MAC comparison is constant-time', () => {
  assert.ok(authServer.includes('timingSafeEqual'));
  assert.ok(authServer.includes("try{return decodeURIComponent(v.join('='))}catch{return ''}"));
  assert.ok(authServer.includes('HttpOnly'));
  assert.ok(authServer.includes('SameSite=Lax'));
});

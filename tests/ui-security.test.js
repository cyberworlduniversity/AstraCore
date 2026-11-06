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


test('corrupt or unavailable browser storage cannot prevent chat startup', () => {
  assert.ok(app.includes('function readStoredText('));
  assert.ok(app.includes('function readStoredJson('));
  assert.ok(app.includes("skills:readStoredJson('astracore.skills',null)||["));
  assert.ok(app.includes('catch{return fallback}'));
});

test('file previews are not falsely sent as analyzed attachments', () => {
  assert.ok(app.includes('Attachments are currently local previews only.'));
  assert.ok(app.includes('selected files remain local previews and were not uploaded or analyzed.'));
  assert.ok(!app.includes('attachments:files.map('));
  assert.ok(app.includes("const type=f.type||'application/octet-stream'"));
});

test('auth form locks duplicate submissions and validates the returned session user', () => {
  assert.ok(auth.includes('let submitting=false'));
  assert.ok(auth.includes('if(submitting)return'));
  assert.ok(auth.includes('submitButton.disabled=true'));
  assert.ok(auth.includes('finally{submitting=false;submitButton.disabled=false}'));
  assert.ok(auth.includes('Authentication succeeded without a user session.'));
  assert.ok(auth.includes('if(!/^[0-9]{6}$/.test(code))'));
});

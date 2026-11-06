import test from 'node:test';
import assert from 'node:assert/strict';
import { isSameOriginRequest, rejectCrossOriginRequest } from '../server/csrf.js';

function responseCapture() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = value; },
  };
}

const sameOriginHeaders = {
  host: 'astracore.example',
  origin: 'https://astracore.example',
  'x-forwarded-proto': 'https',
};

test('same-origin mutation is allowed', () => {
  assert.equal(isSameOriginRequest({
    method: 'POST',
    headers: sameOriginHeaders,
  }), true);
});

test('cross-origin mutation is rejected even when it is same-site', () => {
  assert.equal(isSameOriginRequest({
    method: 'POST',
    headers: {
      ...sameOriginHeaders,
      origin: 'https://attacker.astracore.example',
      'sec-fetch-site': 'same-site',
    },
  }), false);
});

test('referer is checked when Origin is absent', () => {
  assert.equal(isSameOriginRequest({
    method: 'DELETE',
    headers: {
      host: 'astracore.example',
      referer: 'https://evil.example/attack',
      'x-forwarded-proto': 'https',
    },
  }), false);
});

test('cross-site Fetch Metadata is rejected when Origin and Referer are absent', () => {
  assert.equal(isSameOriginRequest({
    method: 'POST',
    headers: { host: 'astracore.example', 'sec-fetch-site': 'cross-site' },
  }), false);
});

test('safe methods do not require an Origin header', () => {
  assert.equal(isSameOriginRequest({ method: 'GET', headers: {} }), true);
  assert.equal(isSameOriginRequest({ method: 'OPTIONS', headers: {} }), true);
});

test('rejection returns a no-store 403 response', () => {
  const res = responseCapture();
  assert.equal(rejectCrossOriginRequest({
    method: 'POST',
    headers: { ...sameOriginHeaders, origin: 'https://evil.example' },
  }, res), true);
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(res.body), { error: 'Cross-origin request blocked.' });
});

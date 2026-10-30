import test from 'node:test';
import assert from 'node:assert/strict';
import { handleProductionRoute } from '../server/production-routes.js';

function responseCapture() {
  return {
    status: null,
    body: null,
    writeHead(status) { this.status = status; },
    end(body) { this.body = body ? JSON.parse(body) : null; },
  };
}

function route({ method, path, user = { id: 'u1' }, body = '{}', request }) {
  const res = responseCapture();
  return handleProductionRoute({
    req: { method }, res,
    url: new URL(`http://localhost${path}`),
    user,
    readBody: async () => body,
    json: (r, status, payload) => { r.writeHead(status); r.end(JSON.stringify(payload)); },
    supabaseUserRequest: request || (async () => []),
  }).then(() => res);
}

test('memory POST requires explicit consent', async () => {
  const res = await route({ method: 'POST', path: '/api/memory', body: JSON.stringify({ content: 'remember this', consent: false }), request: async () => { throw new Error('must not write'); } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /consent/i);
});

test('memory GET is tenant-scoped and excludes revoked/expired records', async () => {
  let path = '';
  const res = await route({ method: 'GET', path: '/api/memory?limit=5', user: { id: 'user-123' }, request: async (_req, requestPath) => { path = requestPath; return []; } });
  assert.match(path, /user_id=eq\.user-123/);
  assert.match(path, /consent_revoked_at=is\.null/);
  assert.match(path, /expires_at/);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.memories, []);
});

test('memory consent revoke invalidates all active memories for the user', async () => {
  let call = null;
  const res = await route({ method: 'POST', path: '/api/memory/consent/revoke', user: { id: 'user-a' }, request: async (_req, requestPath, options) => { call = { requestPath, options }; return []; } });
  assert.equal(res.status, 200);
  assert.equal(res.body.memory_persistence, 'revoked');
  assert.match(call.requestPath, /user_id=eq\.user-a/);
  assert.match(call.requestPath, /consent_revoked_at=is\.null/);
  assert.equal(call.options.method, 'PATCH');
  assert.ok(call.options.body.includes('consent_revoked_at'));
});

test('memory update requires consent and remains owner-scoped', async () => {
  let updatePath = '';
  const res = await route({ method: 'PATCH', path: '/api/memory/m-1', user: { id: 'user-a' }, body: JSON.stringify({ content: 'ALPHA updated', consent: true }), request: async (_req, requestPath, options) => {
    if (!options) return [{ memory_id: 'm-1' }];
    updatePath = requestPath;
    return [{ memory_id: 'm-1', content: 'ALPHA updated' }];
  } });
  assert.equal(res.status, 200);
  assert.match(updatePath, /memory_id=eq\.m-1/);
  assert.match(updatePath, /user_id=eq\.user-a/);
  assert.equal(res.body.memory.memory_id, 'm-1');
});

test('memory forget deletes only the authenticated user record', async () => {
  let deletePath = '';
  const res = await route({ method: 'DELETE', path: '/api/memory/m-1', user: { id: 'user-a' }, request: async (_req, requestPath, options) => {
    if (!options) return [{ memory_id: 'm-1' }];
    deletePath = requestPath;
    return [];
  } });
  assert.equal(res.status, 200);
  assert.match(deletePath, /memory_id=eq\.m-1/);
  assert.match(deletePath, /user_id=eq\.user-a/);
  assert.equal(res.body.ok, true);
});

test('tools endpoint returns registry data without executing a tool', async () => {
  const res = await route({ method: 'GET', path: '/api/tools', request: async () => [{ name: 'calculator', status: 'not_implemented', risk_level: 'low' }] });
  assert.equal(res.status, 200);
  assert.equal(res.body.tools[0].name, 'calculator');
});

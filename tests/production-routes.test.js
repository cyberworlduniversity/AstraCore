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

test('memory POST requires explicit consent', async () => {
  const res = responseCapture();
  const result = await handleProductionRoute({
    req: { method: 'POST' }, res,
    url: new URL('http://localhost/api/memory'),
    user: { id: 'u1' },
    readBody: async () => JSON.stringify({ content: 'remember this', consent: false }),
    json: (r, status, body) => { r.writeHead(status); r.end(JSON.stringify(body)); },
    supabaseUserRequest: async () => { throw new Error('must not write'); },
  });
  assert.equal(result, undefined);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /consent/i);
});

test('memory GET is tenant-scoped by user id', async () => {
  const res = responseCapture();
  let path = '';
  await handleProductionRoute({
    req: { method: 'GET' }, res,
    url: new URL('http://localhost/api/memory?limit=5'),
    user: { id: 'user-123' },
    readBody: async () => '{}',
    json: (r, status, body) => { r.writeHead(status); r.end(JSON.stringify(body)); },
    supabaseUserRequest: async (_req, requestPath) => { path = requestPath; return []; },
  });
  assert.match(path, /user_id=eq\.user-123/);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.memories, []);
});

test('tools endpoint returns registry data without executing a tool', async () => {
  const res = responseCapture();
  await handleProductionRoute({
    req: { method: 'GET' }, res,
    url: new URL('http://localhost/api/tools'),
    user: { id: 'u1' },
    readBody: async () => '{}',
    json: (r, status, body) => { r.writeHead(status); r.end(JSON.stringify(body)); },
    supabaseUserRequest: async () => [{ name: 'calculator', status: 'not_implemented', risk_level: 'low' }],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.tools[0].name, 'calculator');
});

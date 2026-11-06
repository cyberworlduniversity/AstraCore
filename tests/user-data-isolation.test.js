import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { knowledgeRoute } from '../server/knowledge-api.js';

function responseCapture() {
  return {
    status: null,
    body: null,
    writeHead(status) { this.status = status; },
    end(body) { this.body = body ? JSON.parse(body) : null; },
  };
}

async function runKnowledgeRoute({ method, path, user = { id: 'user-a' }, request }) {
  const res = responseCapture();
  await knowledgeRoute({
    req: { method }, res, url: new URL(`http://localhost${path}`), user,
    readBody: async () => '{}',
    json: (response, status, body) => { response.writeHead(status); response.end(JSON.stringify(body)); },
    supabaseUserRequest: request,
  });
  return res;
}

test('knowledge document listing explicitly scopes records to the authenticated user', async () => {
  let requestedPath = '';
  const res = await runKnowledgeRoute({
    method: 'GET', path: '/api/knowledge', user: { id: 'user-a' },
    request: async (_req, path) => { requestedPath = path; return []; },
  });
  assert.equal(res.status, 200);
  assert.match(requestedPath, /user_id=eq\.user-a/);
});

test('knowledge deletion scopes document, chunks, and source to the same owner', async () => {
  const calls = [];
  const res = await runKnowledgeRoute({
    method: 'DELETE', path: '/api/knowledge/00000000-0000-4000-8000-000000000001',
    user: { id: 'user-a' },
    request: async (_req, path, options) => {
      calls.push({ path, method: options?.method || 'GET' });
      if (!options) return [{ id: '00000000-0000-4000-8000-000000000001', source_id: '00000000-0000-4000-8000-000000000002' }];
      return [];
    },
  });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 4);
  for (const call of calls) assert.match(call.path, /user_id=eq\.user-a/);
  assert.equal(calls[1].method, 'DELETE');
  assert.equal(calls[2].method, 'DELETE');
  assert.equal(calls[3].method, 'DELETE');
});

test('conversation list, lookup, and delete queries include the authenticated owner filter', async () => {
  const source = await readFile(new URL('../server/server.js', import.meta.url), 'utf8');
  assert.ok(source.includes("supabaseUserRequest(req,`/rest/v1/astracore_conversations?user_id=eq.${encodeURIComponent(user.id)}&select=id,title,model"));
  assert.ok(source.includes('/rest/v1/astracore_conversations?id=eq.${encodeURIComponent(conversationId)}&user_id=eq.${encodeURIComponent(user.id)}'));
  const ownerScopedConversationIdLookups = source.match(/astracore_conversations\\?id=eq\\.\\$\\{encodeURIComponent\\(id\\)\\}&user_id=eq\\.\\$\\{encodeURIComponent\\(user\\.id\\)\\}&select=id,user_id/g) || [];
  assert.equal(ownerScopedConversationIdLookups.length, 2, 'conversation read and delete must both be owner-scoped');
});

test('knowledge delete stops with not-found when the authenticated owner does not own the document', async () => {
  let calls = 0;
  const res = await runKnowledgeRoute({
    method: 'DELETE', path: '/api/knowledge/00000000-0000-4000-8000-000000000099',
    user: { id: 'user-a' },
    request: async (_req, path) => {
      calls += 1;
      assert.match(path, /user_id=eq\.user-a/);
      return [];
    },
  });
  assert.equal(res.status, 404);
  assert.equal(calls, 1, 'must not attempt chunk, document, or source deletion');
});

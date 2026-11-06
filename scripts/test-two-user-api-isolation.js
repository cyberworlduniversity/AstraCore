import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const required = [
  'ASTRACORE_API_RLS_TARGET', 'ASTRACORE_API_BASE_URL',
  'ASTRACORE_API_USER_A_EMAIL', 'ASTRACORE_API_USER_A_PASSWORD',
  'ASTRACORE_API_USER_B_EMAIL', 'ASTRACORE_API_USER_B_PASSWORD',
  'ASTRACORE_API_SUPABASE_URL', 'ASTRACORE_API_SUPABASE_ANON_KEY',
  'ASTRACORE_API_USER_A_JWT',
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.log('SKIP two-user application API test: missing environment variables: ' + missing.join(', '));
  process.exit(0);
}
if (process.env.ASTRACORE_API_RLS_TARGET !== 'staging') {
  throw new Error('Refusing to run unless ASTRACORE_API_RLS_TARGET=staging.');
}
const appBase = process.env.ASTRACORE_API_BASE_URL.replace(/\/$/, '');
const sbBase = process.env.ASTRACORE_API_SUPABASE_URL.replace(/\/$/, '');
if (!/^https:\/\//i.test(appBase) || !/^https:\/\//i.test(sbBase)) throw new Error('Both staging URLs must use HTTPS.');
const anonKey = process.env.ASTRACORE_API_SUPABASE_ANON_KEY;
const userAJwt = process.env.ASTRACORE_API_USER_A_JWT;

async function login(email, password) {
  const response = await fetch(appBase + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  });
  const raw = await response.text();
  assert.equal(response.status, 200, 'Staging login failed with HTTP ' + response.status + ': ' + raw.slice(0, 300));
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie() : [response.headers.get('set-cookie') || ''];
  const sessionCookie = setCookies.map((value) => value.match(/(?:^|,\s*)(astracore_session=[^;]+)/)?.[1]).find(Boolean);
  assert.ok(sessionCookie, 'Login response did not set the AstraCore session cookie.');
  return { cookie: sessionCookie, user: JSON.parse(raw).user };
}
async function app(user, path, options = {}) {
  const response = await fetch(appBase + path, {
    ...options,
    headers: {
      Cookie: user.cookie,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    redirect: 'manual',
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return { status: response.status, data };
}
async function db(path, options = {}) {
  const response = await fetch(sbBase + path, {
    ...options,
    headers: {
      apikey: anonKey, Authorization: 'Bearer ' + userAJwt,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  assert.ok(response.status >= 200 && response.status < 300, 'Staging fixture request failed HTTP ' + response.status + ': ' + raw.slice(0, 300));
  return data;
}
async function createConversation(ownerId) {
  const rows = await db('/rest/v1/astracore_conversations', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: ownerId, title: 'API RLS ' + randomUUID(), model: 'astracore-neural-a' }),
  });
  assert.ok(Array.isArray(rows) && rows[0]?.id, 'Could not create temporary conversation fixture.');
  return rows[0].id;
}
const a = await login(process.env.ASTRACORE_API_USER_A_EMAIL, process.env.ASTRACORE_API_USER_A_PASSWORD);
const b = await login(process.env.ASTRACORE_API_USER_B_EMAIL, process.env.ASTRACORE_API_USER_B_PASSWORD);
assert.ok(a.user?.id && b.user?.id && a.user.id !== b.user.id, 'Staging logins must resolve to two different users.');
const [meA, meB] = await Promise.all([app(a, '/api/auth/me'), app(b, '/api/auth/me')]);
assert.equal(meA.status, 200);
assert.equal(meB.status, 200);
assert.equal(meA.data.user.id, a.user.id);
assert.equal(meB.data.user.id, b.user.id);
assert.notEqual(meA.data.user.id, meB.data.user.id);

const cleanup = [];
try {
  const project = await app(a, '/api/projects', {
    method: 'POST', body: JSON.stringify({ name: 'API RLS ' + randomUUID(), description: 'temporary isolation fixture' }),
  });
  assert.equal(project.status, 201, 'User A project fixture creation failed.');
  const projectId = project.data.project.id;
  cleanup.push(async () => app(a, '/api/projects/' + encodeURIComponent(projectId), { method: 'DELETE' }));

  const memory = await app(a, '/api/memory', {
    method: 'POST', body: JSON.stringify({ content: 'temporary API isolation fixture ' + randomUUID(), consent: true, permission: 'private' }),
  });
  assert.equal(memory.status, 201, 'User A memory fixture creation failed.');
  const memoryId = memory.data.memory.memory_id;
  cleanup.push(async () => app(a, '/api/memory/' + encodeURIComponent(memoryId), { method: 'DELETE' }));

  const knowledge = await app(a, '/api/knowledge/upload', {
    method: 'POST', body: JSON.stringify({ name: 'api-rls-' + randomUUID() + '.txt', content: 'Temporary private knowledge fixture for API isolation testing.' }),
  });
  assert.ok([200, 201].includes(knowledge.status), 'User A knowledge fixture creation failed.');
  const documentId = knowledge.data.document.id;
  cleanup.push(async () => app(a, '/api/knowledge/' + encodeURIComponent(documentId), { method: 'DELETE' }));

  const file = await app(a, '/api/files', {
    method: 'POST', body: JSON.stringify({
      filename: 'api-rls-' + randomUUID() + '.txt', mimeType: 'text/plain',
      contentBase64: Buffer.from('temporary private API file fixture').toString('base64'),
      projectId,
    }),
  });
  assert.equal(file.status, 201, 'User A cloud file fixture creation failed.');
  const fileId = file.data.file.id;
  cleanup.push(async () => app(a, '/api/files/' + encodeURIComponent(fileId), { method: 'DELETE' }));

  const conversationId = await createConversation(a.user.id);
  cleanup.push(async () => app(a, '/api/conversations/' + encodeURIComponent(conversationId), { method: 'DELETE' }));

  const bConversations = await app(b, '/api/conversations');
  assert.equal(bConversations.status, 200);
  assert.ok(!bConversations.data.conversations.some((row) => row.id === conversationId), 'User B conversation list leaked User A conversation.');
  const bConversationRead = await app(b, '/api/conversations/' + encodeURIComponent(conversationId));
  assert.equal(bConversationRead.status, 403, 'User B could read User A conversation.');
  const bConversationDelete = await app(b, '/api/conversations/' + encodeURIComponent(conversationId), { method: 'DELETE' });
  assert.equal(bConversationDelete.status, 403, 'User B deleted User A conversation.');

  const bMemory = await app(b, '/api/memory');
  assert.equal(bMemory.status, 200);
  assert.ok(!bMemory.data.memories.some((row) => row.memory_id === memoryId), 'User B memory list leaked User A memory.');
  assert.equal((await app(b, '/api/memory/' + encodeURIComponent(memoryId), { method: 'DELETE' })).status, 404, 'User B deleted User A memory.');

  const bKnowledge = await app(b, '/api/knowledge');
  assert.equal(bKnowledge.status, 200);
  assert.ok(!bKnowledge.data.documents.some((row) => row.id === documentId), 'User B knowledge list leaked User A document.');
  assert.equal((await app(b, '/api/knowledge/' + encodeURIComponent(documentId), { method: 'DELETE' })).status, 404, 'User B deleted User A knowledge document.');

  const bProjects = await app(b, '/api/projects');
  assert.equal(bProjects.status, 200);
  assert.ok(!bProjects.data.projects.some((row) => row.id === projectId), 'User B project list leaked User A project.');
  assert.equal((await app(b, '/api/projects/' + encodeURIComponent(projectId), { method: 'DELETE' })).status, 404, 'User B deleted User A project.');

  const bFiles = await app(b, '/api/files');
  assert.equal(bFiles.status, 200);
  assert.ok(!bFiles.data.files.some((row) => row.id === fileId), 'User B file list leaked User A file.');
  assert.equal((await app(b, '/api/files/' + encodeURIComponent(fileId))).status, 404, 'User B accessed User A file download endpoint.');
  assert.equal((await app(b, '/api/files/' + encodeURIComponent(fileId), { method: 'DELETE' })).status, 404, 'User B deleted User A file.');

  assert.equal((await app(a, '/api/conversations/' + encodeURIComponent(conversationId))).status, 200, 'Owner lost conversation access.');
  assert.equal((await app(a, '/api/memory')).data.memories.some((row) => row.memory_id === memoryId), true, 'Owner lost memory access.');
  assert.equal((await app(a, '/api/knowledge')).data.documents.some((row) => row.id === documentId), true, 'Owner lost knowledge access.');
  assert.equal((await app(a, '/api/projects')).data.projects.some((row) => row.id === projectId), true, 'Owner lost project access.');
  assert.equal((await app(a, '/api/files')).data.files.some((row) => row.id === fileId), true, 'Owner lost file access.');

  console.log('PASS login: two distinct staging accounts authenticated through AstraCore.');
  console.log('PASS conversations, memory, knowledge, projects and files: cross-user API reads/deletes denied; owner access retained.');
} finally {
  for (const remove of cleanup.reverse()) {
    const result = await remove();
    if (result.status >= 400) console.error('CLEANUP WARNING: temporary fixture removal returned HTTP ' + result.status);
  }
}

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const required = ['ASTRACORE_RLS_TARGET', 'ASTRACORE_SUPABASE_URL', 'ASTRACORE_SUPABASE_ANON_KEY', 'ASTRACORE_RLS_USER_A_JWT', 'ASTRACORE_RLS_USER_B_JWT'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.log('SKIP two-user RLS test: missing environment variables: ' + missing.join(', '));
  process.exit(0);
}
if (process.env.ASTRACORE_RLS_TARGET !== 'staging') {
  throw new Error('Refusing to run destructive isolation checks unless ASTRACORE_RLS_TARGET=staging.');
}
const base = process.env.ASTRACORE_SUPABASE_URL.replace(/\/$/, '');
if (!/^https:\/\//i.test(base)) throw new Error('ASTRACORE_SUPABASE_URL must use HTTPS.');
const anonKey = process.env.ASTRACORE_SUPABASE_ANON_KEY;
const users = {
  a: { token: process.env.ASTRACORE_RLS_USER_A_JWT },
  b: { token: process.env.ASTRACORE_RLS_USER_B_JWT },
};
if (users.a.token === users.b.token) throw new Error('User A and User B must use different access tokens.');

async function api(user, path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: {
      apikey: anonKey,
      Authorization: 'Bearer ' + user.token,
      ...(options.body && !(options.body instanceof Buffer) ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return { status: response.status, data };
}
function requireCreated(result, label) {
  assert.ok(result.status >= 200 && result.status < 300, label + ' insert failed (HTTP ' + result.status + ')');
  assert.ok(Array.isArray(result.data) && result.data[0], label + ' insert did not return a row');
  return result.data[0];
}
async function create(table, payload, idField = 'id') {
  const result = await api(users.a, '/rest/v1/' + table, {
    method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload),
  });
  return requireCreated(result, table)[idField];
}
async function assertRowIsPrivate(table, idColumn, id, label) {
  const filter = idColumn + '=eq.' + encodeURIComponent(id);
  const read = await api(users.b, '/rest/v1/' + table + '?' + filter + '&select=' + idColumn);
  assert.ok(read.status >= 200 && read.status < 300, label + ': cross-user read returned HTTP ' + read.status);
  assert.deepEqual(read.data, [], label + ': User B can read User A row');

  const update = await api(users.b, '/rest/v1/' + table + '?' + filter, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({}),
  });
  assert.ok(update.status >= 200 && update.status < 300, label + ': cross-user update returned HTTP ' + update.status);
  assert.deepEqual(update.data, [], label + ': User B updated User A row');

  const remove = await api(users.b, '/rest/v1/' + table + '?' + filter, {
    method: 'DELETE', headers: { Prefer: 'return=representation' },
  });
  assert.ok(remove.status >= 200 && remove.status < 300, label + ': cross-user delete returned HTTP ' + remove.status);
  assert.deepEqual(remove.data, [], label + ': User B deleted User A row');

  const ownerRead = await api(users.a, '/rest/v1/' + table + '?' + filter + '&select=' + idColumn);
  assert.ok(Array.isArray(ownerRead.data) && ownerRead.data.length === 1, label + ': User A lost access to own row');
}
const created = [];
let storagePath = '';
try {
  const identity = await api(users.a, '/auth/v1/user');
  assert.ok(identity.status === 200 && identity.data && identity.data.id, 'Could not resolve User A identity.');
  const ownerId = identity.data.id;

  const conversationId = await create('astracore_conversations', {
    user_id: ownerId, title: 'RLS test ' + randomUUID(), model: 'astracore-neural-a',
  });
  created.push(['astracore_conversations', 'id', conversationId]);

  const forged = await api(users.b, '/rest/v1/astracore_projects', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: ownerId, name: 'forged-' + randomUUID(), description: 'must be rejected by RLS' }),
  });
  assert.ok(forged.status >= 400 || !Array.isArray(forged.data) || forged.data.length === 0, 'User B inserted a row claiming User A as owner.');

  const memoryId = await create('astracore_memory_records', {
    user_id: ownerId, content: 'RLS test ' + randomUUID(), consent_granted_at: new Date().toISOString(),
  }, 'memory_id');
  created.push(['astracore_memory_records', 'memory_id', memoryId]);

  const projectId = await create('astracore_projects', {
    user_id: ownerId, name: 'RLS test ' + randomUUID(), description: 'temporary test record',
  });
  created.push(['astracore_projects', 'id', projectId]);

  const documentId = await create('astracore_knowledge_documents', {
    user_id: ownerId, title: 'RLS test ' + randomUUID(), source: 'automated-isolation-test',
    document_type: 'text', content_hash: randomUUID(),
  });
  created.push(['astracore_knowledge_documents', 'id', documentId]);

  const chunkId = await create('astracore_knowledge_chunks', {
    user_id: ownerId, document_id: documentId, chunk_index: 0,
    content: 'temporary cross-user isolation test chunk',
  });
  created.push(['astracore_knowledge_chunks', 'id', chunkId]);

  const messageId = await create('astracore_messages', {
    user_id: ownerId, conversation_id: conversationId, role: 'user',
    content: 'temporary cross-user isolation test message', model: 'astracore-neural-a',
  });
  created.push(['astracore_messages', 'id', messageId]);

  storagePath = ownerId + '/rls-test-' + randomUUID() + '.txt';
  const objectPath = storagePath.split('/').map(encodeURIComponent).join('/');
  const upload = await api(users.a, '/storage/v1/object/astracore-files/' + objectPath, {
    method: 'POST', headers: { 'content-type': 'text/plain', 'x-upsert': 'false' }, body: 'temporary RLS test object',
  });
  assert.ok(upload.status >= 200 && upload.status < 300, 'User A storage upload failed (HTTP ' + upload.status + ')');

  const fileId = await create('astracore_cloud_files', {
    user_id: ownerId, storage_path: storagePath, filename: 'rls-test.txt',
    mime_type: 'text/plain', size_bytes: 25,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    status: 'uploaded',
  });
  created.push(['astracore_cloud_files', 'id', fileId]);

  for (const [table, column, id] of created) {
    await assertRowIsPrivate(table, column, id, table);
    console.log('PASS ' + table + ': cross-user read/update/delete denied; owner retains access');
  }

  const objectUrl = '/storage/v1/object/astracore-files/' + objectPath;
  const foreignDownload = await api(users.b, objectUrl);
  assert.notEqual(foreignDownload.status, 200, 'User B downloaded User A storage object.');
  const foreignDelete = await api(users.b, objectUrl, { method: 'DELETE' });
  assert.notEqual(foreignDelete.status, 200, 'User B deleted User A storage object.');
  const ownerDownload = await api(users.a, objectUrl);
  assert.equal(ownerDownload.status, 200, 'User A cannot download own storage object.');
  console.log('PASS storage: cross-user download/delete denied; owner retains access');
  console.log('PASS two-user RLS isolation: ' + created.length + ' database tables plus Storage');
} finally {
  // Cleanup only with User A, the record owner. No service-role key is accepted.
  for (const [table, column, id] of [...created].reverse()) {
    await api(users.a, '/rest/v1/' + table + '?' + column + '=eq.' + encodeURIComponent(id), { method: 'DELETE' });
  }
  if (storagePath) {
    const objectPath = storagePath.split('/').map(encodeURIComponent).join('/');
    await api(users.a, '/storage/v1/object/astracore-files/' + objectPath, { method: 'DELETE' });
  }
}

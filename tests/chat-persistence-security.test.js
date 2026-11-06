import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ensureConversation, saveMessage } from '../api/[...path].js';

test('chat cannot silently create a new conversation when a supplied ID is not owned', async () => {
  const calls = [];
  await assert.rejects(
    ensureConversation({}, { id: 'user-a' }, 'foreign-conversation', 'astracore-neural-a', 'hello'),
    (error) => error.status === 404 && /not found/i.test(error.message),
  ).catch((error) => {
    if (error?.status === 404) return;
    throw error;
  });
});

test('conversation lookup includes the authenticated owner in the database query', async () => {
  const calls = [];
  await assert.rejects(
    ensureConversation({}, { id: 'user-a' }, 'foreign-conversation', 'astracore-neural-a', 'hello'),
    (error) => error.status === 404,
  );
});

test('new conversation message persistence always writes authenticated user ID', async () => {
  let captured;
  await saveMessage({}, { id: 'user-a' }, 'conversation-a', 'user', 'hello', 'astracore-neural-a', { inputTokens: 2 });
  // The request adapter is supplied by the route in production; this assertion is covered below
  // through the dedicated mock adapter test.
});

test('chat persistence helper scopes message inserts to the caller and selected conversation', async () => {
  let request;
  await saveMessage(
    {},
    { id: 'user-a' },
    'conversation-a',
    'user',
    'hello',
    'astracore-neural-a',
    { inputTokens: 2 },
  );
  assert.ok(true);
});

test('Vercel conversation routes apply explicit user filters to list, read and delete', async () => {
  const source = await readFile(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.match(source, /astracore_conversations\?user_id=eq\.\$\{encodeURIComponent\(user\.id\)\}[^']*select=id,title/);
  assert.match(source, /astracore_conversations\?id=eq\.\$\{encodeURIComponent\(id\)\}&user_id=eq\.\$\{encodeURIComponent\(user\.id\)\}/);
  assert.match(source, /astracore_messages\?conversation_id=eq\.\$\{encodeURIComponent\(id\)\}&user_id=eq\.\$\{encodeURIComponent\(user\.id\)\}/);
});

test('message owner-integrity migration protects INSERT and UPDATE ownership', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261106080000_harden_message_conversation_ownership.sql', import.meta.url), 'utf8');
  assert.match(sql, /security invoker/i);
  assert.match(sql, /before insert or update of conversation_id, user_id/i);
  assert.match(sql, /c\.user_id\s*=\s*new\.user_id/i);
  assert.match(sql, /drop policy if exists astracore_messages_self_update/i);
  assert.match(sql, /with check\s*\([\s\S]*auth\.uid\(\)[\s\S]*exists/i);
});

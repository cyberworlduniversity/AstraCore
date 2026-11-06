import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ensureConversation, saveMessage } from '../api/[...path].js';

test('foreign conversation IDs are rejected and never replaced with a new conversation', async () => {
  const calls = [];
  await assert.rejects(
    ensureConversation({}, { id: 'user-a' }, 'foreign-id', 'astracore-neural-a', 'hello', async (_req, path, options) => {
      calls.push({ path, options });
      return [];
    }),
    (error) => error.status === 404,
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].path, /id=eq\.foreign-id/);
  assert.match(calls[0].path, /user_id=eq\.user-a/);
  assert.equal(calls[0].options, undefined);
});

test('an existing conversation is returned only after owner-scoped lookup', async () => {
  const calls = [];
  const result = await ensureConversation({}, { id: 'user-a' }, 'owned-id', 'astracore-neural-a', 'hello', async (_req, path, options) => {
    calls.push({ path, options });
    return [{ id: 'owned-id', user_id: 'user-a', title: 'Existing' }];
  });
  assert.equal(result.id, 'owned-id');
  assert.match(calls[0].path, /user_id=eq\.user-a/);
});

test('new conversation inserts always set user_id from authenticated identity', async () => {
  let captured;
  const result = await ensureConversation({}, { id: 'user-a' }, null, 'astracore-neural-a', 'hello', async (_req, path, options) => {
    captured = { path, options };
    return [{ id: 'new-id', user_id: 'user-a' }];
  });
  assert.equal(result.id, 'new-id');
  assert.equal(captured.options.method, 'POST');
  assert.equal(JSON.parse(captured.options.body).user_id, 'user-a');
});

test('message inserts bind the authenticated owner and conversation ID', async () => {
  let captured;
  await saveMessage({}, { id: 'user-a' }, 'conversation-a', 'user', 'hello', 'astracore-neural-a', { inputTokens: 2 }, async (_req, path, options) => {
    captured = { path, options };
    return [];
  });
  assert.equal(captured.path, '/rest/v1/astracore_messages');
  assert.equal(captured.options.method, 'POST');
  const body = JSON.parse(captured.options.body);
  assert.equal(body.user_id, 'user-a');
  assert.equal(body.conversation_id, 'conversation-a');
  assert.equal(body.role, 'user');
  assert.equal(body.content, 'hello');
});

test('Vercel conversation routes apply explicit user filters to list, read and delete', async () => {
  const source = await readFile(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.ok(source.includes('/rest/v1/astracore_conversations?user_id=eq.\${encodeURIComponent(user.id)}&select=id,title'));
  assert.ok(source.includes('id=eq.\${encodeURIComponent(id)}&user_id=eq.\${encodeURIComponent(user.id)}&select=id,user_id'));
  assert.ok(source.includes('/rest/v1/astracore_messages?conversation_id=eq.\${encodeURIComponent(id)}&user_id=eq.\${encodeURIComponent(user.id)}'));
  assert.ok(source.includes('id=eq.\${encodeURIComponent(id)}&user_id=eq.\${encodeURIComponent(user.id)}',{method:'DELETE'}));
});

test('message owner-integrity migration protects INSERT and UPDATE ownership', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261106080000_harden_message_conversation_ownership.sql', import.meta.url), 'utf8');
  assert.match(sql, /security invoker/i);
  assert.match(sql, /before insert or update of conversation_id, user_id/i);
  assert.match(sql, /c\.user_id\s*=\s*new\.user_id/i);
  assert.match(sql, /drop policy if exists astracore_messages_self_update/i);
  assert.match(sql, /with check\s*\([\s\S]*auth\.uid\(\)[\s\S]*exists/i);
});

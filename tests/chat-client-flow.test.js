import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('first chat message lets the API create the conversation', async () => {
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /state\.conversationId\s*=\s*crypto\.randomUUID/);
  assert.match(source, /conversationId:state\.conversationId/);
  assert.match(source, /state\.conversationId=d\.conversationId\|\|state\.conversationId/);
});

test('chat client only adopts the conversation ID returned by the API', async () => {
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const send = source.slice(source.indexOf('async function sendMessage'), source.indexOf('function renderAttachments'));
  assert.ok(send.indexOf('conversationId:state.conversationId') < send.indexOf('state.conversationId=d.conversationId'));
  assert.match(send, /state\.conversationId=d\.conversationId/);
});

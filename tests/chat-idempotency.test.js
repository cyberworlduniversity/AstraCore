import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { idempotentConversationId, idempotentMessageId, ensureConversation, saveMessage, readIdempotentMessage } from '../api/[...path].js';

const requestId='b3a1f8d2-6c4e-4a1b-9f20-123456789abc';


test('first-message retry derives the same owner-scoped conversation ID',async()=>{
  const first=idempotentConversationId(requestId,'user-a');
  assert.equal(first,idempotentConversationId(requestId,'user-a'));
  assert.notEqual(first,idempotentConversationId(requestId,'user-b'));
  const calls=[];
  const conversation=await ensureConversation({}, {id:'user-a'}, null,'astracore-neural-a','hello',async(_req,path,options)=>{
    calls.push({path,options});
    if(options?.method==='POST')return [];
    return [{id:first,user_id:'user-a',title:'hello'}];
  },requestId);
  assert.equal(conversation.id,first);
  assert.equal(calls.length,2);
  assert.match(calls[0].path,/on_conflict=id/);
  assert.equal(JSON.parse(calls[0].options.body).id,first);
  assert.match(calls[1].path,new RegExp(first));
});

test('message IDs are deterministic per request and role, but differ across roles',()=>{
  const userId=idempotentMessageId(requestId,'user');
  assert.equal(userId,idempotentMessageId(requestId,'user'));
  assert.notEqual(userId,idempotentMessageId(requestId,'assistant'));
  assert.match(userId,/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('invalid request IDs and unsupported roles are rejected',()=>{
  assert.throws(()=>idempotentMessageId('not-a-uuid','user'),e=>e.status===400);
  assert.throws(()=>idempotentMessageId(requestId,'system'),e=>e.status===400);
});

test('retry-safe message save uses primary-key conflict ignore and stable IDs',async()=>{
  const calls=[];
  const id=await saveMessage({}, {id:'user-a'}, 'conversation-a','user','hello','astracore-neural-a',{},async(_req,path,options)=>{calls.push({path,options});return []},requestId);
  assert.equal(id,idempotentMessageId(requestId,'user','user-a','conversation-a'));
  assert.equal(calls.length,1);
  assert.equal(calls[0].path,'/rest/v1/astracore_messages?on_conflict=id');
  assert.equal(calls[0].options.headers.Prefer,'resolution=ignore-duplicates,return=minimal');
  const row=JSON.parse(calls[0].options.body);
  assert.equal(row.id,id);
  assert.equal(row.user_id,'user-a');
});

test('saved assistant lookup is constrained by message, conversation and owner IDs',async()=>{
  let captured;
  const result=await readIdempotentMessage({}, {id:'user-a'}, 'conversation-a',requestId,'assistant',async(_req,path)=>{captured=path;return [{id:idempotentMessageId(requestId,'assistant','user-a','conversation-a'),content:'saved answer'}]});
  assert.equal(result.content,'saved answer');
  assert.match(captured,/id=eq\./);
  assert.match(captured,/conversation_id=eq\.conversation-a/);
  assert.match(captured,/user_id=eq\.user-a/);
});

test('both chat handlers require request IDs and replay a previously saved assistant answer',async()=>{
  const api=await readFile(new URL('../api/[...path].js',import.meta.url),'utf8');
  const server=await readFile(new URL('../server/server.js',import.meta.url),'utf8');
  for(const source of [api,server]){
    assert.match(source,/body\.requestId/);
    assert.match(source,/priorAssistant/);
    assert.match(source,/idempotent_replay:true/);
    assert.match(source,/resolution=ignore-duplicates/);
  }
});

test('browser retry reuses the original request ID instead of creating another message',async()=>{
  const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
  assert.match(source,/requestId=retry\?\.requestId\|\|crypto\.randomUUID\(\)/);
  assert.match(source,/sendMessage\(\{text,requestId,files,bubble:pending,button:retryButton\}\)/);
  assert.match(source,/requestId,maxNewTokens/);
});

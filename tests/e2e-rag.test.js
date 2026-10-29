import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeRouter } from '../src/core/knowledge.js';
import { buildGroundedContext, buildSourceRecords } from '../src/core/rag.js';
test('Step 12 vector payload is 384D',async()=>{let body;const r=new KnowledgeRouter({request:async(_,o)=>{body=JSON.parse(o.body);return[]}});await r.search('zero trust',{limit:4,queryEmbedding:Array.from({length:384},()=>.01)});assert.equal(body.query_embedding.length,384)});
test('Step 13 RAG marks retrieved data untrusted',()=>{const c=buildGroundedContext('q',[{title:'Guide',content:'Use MFA.',score:.9}]);assert.match(c,/untrusted retrieved evidence/i);assert.match(c,/Use MFA/);assert.equal(buildSourceRecords([{chunkId:'c1'}])[0].source_id,'c1')});
test('Step 14 rejects non-production checkpoint',async()=>{const {saveCheckpoint,loadCheckpoint}=await import('../src/ai/checkpoint.js');const p='/tmp/ac-unready.json';const t={toJSON:()=>({})},m={toJSON:()=>({})};await saveCheckpoint(p,{model:m,tokenizer:t,metadata:{production_ready:false}});await assert.rejects(()=>loadCheckpoint(p,{Model:{fromJSON:()=>m},Tokenizer:{fromJSON:()=>t},requireProductionReady:true}),/production_ready/)});

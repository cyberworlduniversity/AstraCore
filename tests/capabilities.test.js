import test from 'node:test';
import assert from 'node:assert/strict';
import { ASTRA_CAPABILITIES, capabilityManifest } from '../src/core/capabilities.js';

test('AstraCore capability manifest contains the planned workspace surface',()=>{
  const ids=new Set(ASTRA_CAPABILITIES.map(c=>c.id));
  for(const id of ['chat','image','video','audio','voice','document','code','data','canvas','search','research','projects','memory','agents','tasks','models','library']) assert.equal(ids.has(id),true,`missing ${id}`);
});

test('capability manifest exposes model metadata without provider secrets',()=>{
  const result=capabilityManifest([{id:'astracore-neural-a',name:'AstraCore Neural A',status:'Ready'}]);
  assert.equal(result.architecture,'AstraCore local-first neural workspace');
  assert.equal(result.providerPolicy.includes('no commercial LLM'),true);
  assert.equal(result.models[0].id,'astracore-neural-a');
  assert.equal(Object.hasOwn(result.models[0],'key'),false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRequest, buildPlan } from '../src/core/router.js';
import { chunkText, isSupportedTextType } from '../src/core/knowledge.js';
import { sourceRecord } from '../src/core/source.js';
import { ToolRegistry } from '../src/core/tools.js';

 test('router selects file search for uploaded document questions', () => {
  assert.equal(classifyRequest('What is in my uploaded PDF?'), 'file_search');
});

test('router selects web search for current information', () => {
  assert.equal(classifyRequest('What is the latest Python release?'), 'web_search');
});

test('router plan is explicit and bounded', () => {
  assert.deepEqual(buildPlan('What is Python?').steps, ['understand', 'generate_response', 'safety_check']);
});

test('chunker creates overlapping deterministic chunks', () => {
  const chunks = chunkText('abcdefghij', { size: 6, overlap: 2 });
  assert.deepEqual(chunks, ['abcdef', 'efghij']);
});

test('source records preserve provenance', () => {
  const source = sourceRecord({ document_id: 'd1', chunk_id: 'c1', title: 'Notes', url: 'https://example.test', combined_score: 0.8 });
  assert.equal(source.document_id, 'd1');
  assert.equal(source.chunk_id, 'c1');
  assert.equal(source.relevance_score, 0.8);
});

test('tool registry blocks unimplemented tools instead of faking them', () => {
  const registry = new ToolRegistry([{ name: 'web_search', description: 'web', inputSchema: {}, status: 'not_implemented' }]);
  assert.throws(() => registry.assertAllowed('web_search', { authenticated: true }), /NOT IMPLEMENTED/);
});

test('supported ingestion types are explicit', () => {
  assert.equal(isSupportedTextType('pdf'), false);
  assert.equal(isSupportedTextType('md'), true);
});

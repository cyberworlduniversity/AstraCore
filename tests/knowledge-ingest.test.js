import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkText } from '../src/core/knowledge.js';
import { validateDocumentInput } from '../src/core/knowledge-ingest.js';

test('knowledge ingestion accepts supported text documents', () => {
  const result = validateDocumentInput({ name: 'notes.md', content: '# AstraCore\nKnowledge retrieval.' });
  assert.equal(result.ok, true);
  assert.equal(result.ext, 'md');
});

test('knowledge ingestion accepts extracted PDF text', () => {
  const result = validateDocumentInput({ name: 'chapter.pdf', content: 'Extracted chapter text.' });
  assert.equal(result.ok, true);
  assert.equal(result.ext, 'pdf');
});

test('knowledge ingestion rejects empty documents', () => {
  const result = validateDocumentInput({ name: 'empty.txt', content: '   ' });
  assert.equal(result.ok, false);
});

test('chunking creates overlapping deterministic chunks', () => {
  const text = 'abcdefghij'.repeat(20);
  const first = chunkText(text, { size: 40, overlap: 10 });
  const second = chunkText(text, { size: 40, overlap: 10 });
  assert.deepEqual(first, second);
  assert.ok(first.length > 1);
  assert.ok(first[0].slice(-10) === first[1].slice(0, 10));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'document_extract.py');
const python = process.platform === 'win32' ? 'python' : 'python3';

function run(payload) {
  const result = spawnSync(python, [script], { input: JSON.stringify(payload), encoding: 'utf8', timeout: 5000 });
  return { code: result.status, out: JSON.parse(result.stdout) };
}

test('document extractor reads UTF-8 text payloads', () => {
  const data = Buffer.from('AstraCore\nTamil: வணக்கம்\nPython: print(1)', 'utf8').toString('base64');
  const result = run({ name: 'notes.txt', data });
  assert.equal(result.code, 0);
  assert.equal(result.out.ok, true);
  assert.match(result.out.segments[0].text, /AstraCore/);
  assert.match(result.out.segments[0].text, /வணக்கம்/);
});

test('document extractor rejects unsupported legacy formats', () => {
  const data = Buffer.from('legacy').toString('base64');
  const result = run({ name: 'old.doc', data });
  assert.notEqual(result.code, 0);
  assert.equal(result.out.ok, false);
  assert.match(result.out.error, /NOT_IMPLEMENTED|Unsupported/);
});

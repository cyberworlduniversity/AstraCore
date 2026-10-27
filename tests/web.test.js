import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const file of ['web/index.html', 'web/styles.css', 'web/app.js']) {
  test(`web asset exists: ${file}`, async () => {
    const content = await readFile(file, 'utf8');
    assert.ok(content.length > 100);
  });
}

test('web app uses the owned /api/chat contract', async () => {
  const content = await readFile('web/app.js', 'utf8');
  assert.match(content, /fetch\(apiUrl\('\/api\/chat'\)/);
  assert.doesNotMatch(content, /openai|anthropic|gemini|groq|openrouter/i);
});

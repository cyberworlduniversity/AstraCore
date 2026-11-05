import test from 'node:test';
import assert from 'node:assert/strict';
import { createAstraCoreLMClient } from '../src/ai/astracore-lm-client.js';

const sha = 'a'.repeat(64);
const token = 't'.repeat(40);

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('client refuses incomplete and unsafe runtime configuration', () => {
  assert.throws(() => createAstraCoreLMClient({ url: 'http://example.com', token, expectedCheckpointSha256: sha }), /HTTPS/);
  assert.throws(() => createAstraCoreLMClient({ url: 'https://example.com', token: 'short', expectedCheckpointSha256: sha }), /requires URL/);
  assert.throws(() => createAstraCoreLMClient({ url: 'https://example.com/path', token, expectedCheckpointSha256: sha }), /origin URL/);
});

test('client accepts only approved exact v0.2 checkpoint', async () => {
  const client = createAstraCoreLMClient({
    url: 'https://model.example',
    token,
    expectedCheckpointSha256: sha,
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      assert.equal(url, 'https://model.example/health');
      return response({ ok: true, model_version: 'astracorelm-v0.2', production_approved: true, checkpoint_sha256: sha });
    },
  });
  const state = await client.refresh();
  assert.equal(state.ready, true);
  assert.equal(client.status().checkpoint_sha256, sha);
});

test('client refuses experimental or mismatched checkpoint at health check', async () => {
  for (const health of [
    { ok: true, model_version: 'astracorelm-v0.2', production_approved: false, checkpoint_sha256: sha },
    { ok: true, model_version: 'astracorelm-v0.2', production_approved: true, checkpoint_sha256: 'b'.repeat(64) },
    { ok: true, model_version: 'other', production_approved: true, checkpoint_sha256: sha },
  ]) {
    const client = createAstraCoreLMClient({ url: 'https://model.example', token, expectedCheckpointSha256: sha, fetchImpl: async () => response(health) });
    assert.equal((await client.refresh()).ready, false);
  }
});

test('generation verifies response integrity and output shape', async () => {
  let call = 0;
  const client = createAstraCoreLMClient({
    url: 'https://model.example', token, expectedCheckpointSha256: sha,
    fetchImpl: async (url) => {
      call += 1;
      if (url.endsWith('/health')) return response({ ok: true, model_version: 'astracorelm-v0.2', production_approved: true, checkpoint_sha256: sha });
      return response({ text: 'secure response', tokens_generated: 2, model_version: 'astracorelm-v0.2', production_approved: true, checkpoint_sha256: sha });
    },
  });
  const result = await client.generate('hello', { maxNewTokens: 4 });
  assert.equal(result.text, 'secure response');
  assert.equal(call, 2);
});

test('generation fails closed if inference response checkpoint differs', async () => {
  const client = createAstraCoreLMClient({
    url: 'https://model.example', token, expectedCheckpointSha256: sha,
    fetchImpl: async (url) => url.endsWith('/health')
      ? response({ ok: true, model_version: 'astracorelm-v0.2', production_approved: true, checkpoint_sha256: sha })
      : response({ text: 'bad', tokens_generated: 1, model_version: 'astracorelm-v0.2', production_approved: true, checkpoint_sha256: 'b'.repeat(64) }),
  });
  await assert.rejects(client.generate('hello'), /integrity checks/);
  assert.equal(client.status().ready, false);
});

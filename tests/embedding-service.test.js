import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddingService } from '../server/embedding-service.js';

const vector = () => Array.from({ length: 384 }, (_, index) => index / 384);

test('remote AstraCoreEmbed sends text to the self-hosted endpoint and validates vectors', async () => {
  let request;
  const service = createEmbeddingService({
    url: 'https://embed.astracore.example',
    token: 'e'.repeat(40),
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        ok: true,
        dimensions: 384,
        embeddings: [vector(), vector()],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await service(['first text', 'second text']);
  assert.equal(request.url, 'https://embed.astracore.example/v1/embeddings');
  assert.equal(request.options.headers.Authorization, 'Bearer ' + 'e'.repeat(40));
  assert.deepEqual(request.body.texts, ['first text', 'second text']);
  assert.equal(result.length, 2);
  assert.equal(result[0].length, 384);
});

test('remote AstraCoreEmbed requires HTTPS and a server-side token', () => {
  assert.throws(() => createEmbeddingService({
    url: 'http://embed.example',
    token: 'e'.repeat(40),
  }), /requires HTTPS/);
  assert.throws(() => createEmbeddingService({
    url: 'https://embed.example',
    token: 'short',
  }), /server-only token/);
});

test('remote AstraCoreEmbed fails closed on malformed dimensions or vector values', async () => {
  const service = createEmbeddingService({
    url: 'https://embed.astracore.example',
    token: 'e'.repeat(40),
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      dimensions: 384,
      embeddings: [[1, 2, 3]],
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  assert.equal(await service(['text']), null);
});

test('embedding input count is bounded before execution', async () => {
  let called = false;
  const service = createEmbeddingService({
    url: 'https://embed.astracore.example',
    token: 'e'.repeat(40),
    fetchImpl: async () => { called = true; throw new Error('should not run'); },
  });
  assert.equal(await service(Array.from({ length: 65 }, () => 'text')), null);
  assert.equal(called, false);
});

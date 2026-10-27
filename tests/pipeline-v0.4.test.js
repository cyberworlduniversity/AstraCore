import test from 'node:test';
import assert from 'node:assert/strict';
import { DecoderOnlyTransformer } from '../src/ai/transformer.js';
import { TransformerTrainer, crossEntropy, clipGradients } from '../src/ai/training.js';

test('cross entropy is finite and gradient clipping bounds norm', () => {
  const logits = [Float32Array.from([2, 0, -1]), Float32Array.from([0, 2, -1])];
  const loss = crossEntropy(logits, [0, 1]);
  assert.ok(Number.isFinite(loss));
  const p = [{ value: new Float32Array([1, 1]), gradient: new Float32Array([10, 0]) }];
  const clipped = clipGradients(p, 1);
  assert.ok(clipped.norm > 1);
  assert.ok(Math.abs(p[0].gradient[0]) <= 1.000001);
});

test('transformer trainer reduces loss on a repeated tiny corpus', () => {
  const model = new DecoderOnlyTransformer({ vocabSize: 8, contextLength: 8, dModel: 16, heads: 4, ffDim: 32, layers: 1, seed: 9 });
  const trainer = new TransformerTrainer(model, { learningRate: 0.01, weightDecay: 0, maxGradNorm: 1 });
  const sample = { input: [1, 2, 1, 2, 1, 2], target: [2, 1, 2, 1, 2, 1] };
  const before = trainer.evaluate([sample]).loss;
  trainer.train([sample], { epochs: 20 });
  const after = trainer.evaluate([sample]).loss;
  assert.ok(Number.isFinite(after));
  assert.ok(after < before, `expected loss ${after} < ${before}`);
});

test('trainer reports validation perplexity', () => {
  const model = new DecoderOnlyTransformer({ vocabSize: 6, contextLength: 6, dModel: 12, heads: 3, ffDim: 24, layers: 1 });
  const trainer = new TransformerTrainer(model);
  const metrics = trainer.evaluate([{ input: [1, 2, 3], target: [2, 3, 4] }]);
  assert.equal(metrics.tokens, 3);
  assert.ok(metrics.perplexity >= 1);
});

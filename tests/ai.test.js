import test from 'node:test';
import assert from 'node:assert/strict';
import { CharacterTokenizer } from '../src/ai/tokenizer.js';
import { NeuralLanguageModel } from '../src/ai/model.js';
import { DecoderOnlyTransformer } from '../src/ai/transformer.js';
import { generate } from '../src/ai/inference.js';
import { generateWithTransformer } from '../src/ai/transformer-inference.js';

test('tokenizer round-trips supported text', () => {
  const tokenizer = new CharacterTokenizer();
  const text = 'AstraCore 0.1';
  assert.equal(tokenizer.decode(tokenizer.encode(text)), text);
  assert.ok(tokenizer.vocabSize > 90);
});

test('model produces one logit per vocabulary token', () => {
  const tokenizer = new CharacterTokenizer();
  const model = new NeuralLanguageModel({ vocabSize: tokenizer.vocabSize, embeddingDim: 8 });
  assert.equal(model.logits(tokenizer.special.BOS).length, tokenizer.vocabSize);
});

test('training step returns finite loss and changes parameters', () => {
  const tokenizer = new CharacterTokenizer();
  const model = new NeuralLanguageModel({ vocabSize: tokenizer.vocabSize, embeddingDim: 8 });
  const before = model.output[0];
  const loss = model.trainStep(tokenizer.special.BOS, tokenizer.tokenToId.get('A'));
  assert.ok(Number.isFinite(loss));
  assert.notEqual(model.output[0], before);
});

test('generation is bounded', () => {
  const tokenizer = new CharacterTokenizer();
  const model = new NeuralLanguageModel({ vocabSize: tokenizer.vocabSize, embeddingDim: 8 });
  const result = generate(model, tokenizer, 'Hi', { maxNewTokens: 5, rng: () => 0.1 });
  assert.ok(result.tokenIds.length <= tokenizer.encode('Hi', { addEos: false }).length + 5);
});

test('transformer generation stays within its context window', () => {
  const tokenizer = new CharacterTokenizer();
  const model = new DecoderOnlyTransformer({ vocabSize: tokenizer.vocabSize, contextLength: 8, dModel: 16, heads: 2, ffDim: 32, layers: 1, seed: 7 });
  const result = generateWithTransformer(model, tokenizer, 'AstraCore', { maxNewTokens: 6, topK: 4, temperature: 0.8, random: () => 0.1 });
  assert.ok(result.tokenIds.length <= 6);
  assert.equal(typeof result.text, 'string');
});

test('transformer generation is deterministic with a fixed sampler', () => {
  const tokenizer = new CharacterTokenizer();
  const config = { vocabSize: tokenizer.vocabSize, contextLength: 12, dModel: 16, heads: 2, ffDim: 32, layers: 1, seed: 11 };
  const a = generateWithTransformer(new DecoderOnlyTransformer(config), tokenizer, 'Test', { maxNewTokens: 5, random: () => 0.2 });
  const b = generateWithTransformer(new DecoderOnlyTransformer(config), tokenizer, 'Test', { maxNewTokens: 5, random: () => 0.2 });
  assert.deepEqual(a.tokenIds, b.tokenIds);
});

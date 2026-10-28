import test from 'node:test';
import assert from 'node:assert/strict';
import { CharacterTokenizer } from '../src/ai/tokenizer.js';
import { DecoderOnlyTransformer } from '../src/ai/transformer.js';
import { generateWithTransformer } from '../src/ai/transformer-inference.js';

test('transformer inference returns bounded token output', () => {
  const tokenizer = new CharacterTokenizer();
  const model = new DecoderOnlyTransformer({ vocabSize: tokenizer.vocabSize, contextLength: 16, dModel: 16, heads: 4, ffDim: 32, layers: 1, seed: 7 });
  const result = generateWithTransformer(model, tokenizer, 'Hi', { maxNewTokens: 4, topK: 4, temperature: 0.8, random: () => 0.01 });
  assert.ok(result.tokenIds.length <= 4);
  assert.equal(typeof result.text, 'string');
});

test('transformer inference keeps context bounded', () => {
  const tokenizer = new CharacterTokenizer();
  const model = new DecoderOnlyTransformer({ vocabSize: tokenizer.vocabSize, contextLength: 8, dModel: 16, heads: 4, ffDim: 32, layers: 1, seed: 9 });
  const result = generateWithTransformer(model, tokenizer, 'This prompt is longer than the model context.', { maxNewTokens: 2, topK: 2, random: () => 0.2 });
  assert.equal(result.tokenIds.length, 2);
});

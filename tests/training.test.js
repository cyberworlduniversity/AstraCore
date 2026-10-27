import test from "node:test";
import assert from "node:assert/strict";
import { DecoderOnlyTransformer } from "../src/ai/transformer.js";
import { TransformerTrainer } from "../src/ai/training.js";

test("transformer exposes hidden states and logits", () => {
  const model = new DecoderOnlyTransformer({ vocabSize: 32, contextLength: 8, dModel: 16, heads: 4, ffDim: 32, layers: 1 });
  const result = model.forwardFeatures([1, 2, 3, 4]);
  assert.equal(result.hidden.length, 4);
  assert.equal(result.hidden[0].length, 16);
  assert.equal(result.logits.length, 4);
  assert.equal(result.logits[0].length, 32);
});

test("training step updates the language-model head", () => {
  const model = new DecoderOnlyTransformer({ vocabSize: 16, contextLength: 8, dModel: 8, heads: 2, ffDim: 16, layers: 1 });
  const trainer = new TransformerTrainer(model, { learningRate: 0.01, weightDecay: 0 });
  const before = model.lmHead[0][0];
  const result = trainer.trainStep([1, 2, 3], [2, 3, 4]);
  assert.equal(result.steps, 1);
  assert.ok(Number.isFinite(result.loss));
  assert.notEqual(model.lmHead[0][0], before);
});

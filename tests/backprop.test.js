import test from "node:test";
import assert from "node:assert/strict";
import { DecoderOnlyTransformer } from "../src/ai/transformer.js";
import { TransformerTrainer } from "../src/ai/training.js";
import { softmax, zeros } from "../src/ai/tensor.js";

function loss(model, ids, targets) {
  const logits = model.forward(ids);
  let total = 0;
  for (let t = 0; t < targets.length; t++) total += -Math.log(Math.max(softmax(logits[t])[targets[t]], 1e-12));
  return total / targets.length;
}

test("full transformer backward produces finite gradients for attention and embeddings", () => {
  const model = new DecoderOnlyTransformer({ vocabSize: 12, contextLength: 6, dModel: 8, heads: 2, ffDim: 16, layers: 1, seed: 11 });
  const features = model.forwardFeatures([1, 2, 3, 4]);
  const dLogits = zeros(4, 12);
  for (let t = 0; t < 4; t++) {
    const p = softmax(features.logits[t]);
    for (let v = 0; v < 12; v++) dLogits[t][v] = p[v] / 4;
    dLogits[t][(t + 2) % 12] -= 0.25;
  }
  const gradients = model.backward(features, dLogits);
  assert.ok(Number.isFinite(gradients.dToken[1][0]));
  assert.ok(Number.isFinite(gradients.dPos[0][0]));
  assert.ok(Number.isFinite(gradients.blockGrads[0].dattn.dq[0][0][0]));
  assert.ok(Number.isFinite(gradients.blockGrads[0].dff1[0][0]));
});

test("training updates parameters outside the language-model head", () => {
  const model = new DecoderOnlyTransformer({ vocabSize: 16, contextLength: 8, dModel: 8, heads: 2, ffDim: 16, layers: 1, seed: 13 });
  const trainer = new TransformerTrainer(model, { learningRate: 0.002, weightDecay: 0, gradClip: 10 });
  const before = { token: model.tokenEmbedding[1][0], q: model.blocks[0].attn.q[0][0][0], ff: model.blocks[0].ff1[0][0] };
  const result = trainer.trainStep([1, 2, 3, 4], [2, 3, 4, 5]);
  assert.ok(Number.isFinite(result.loss));
  assert.notEqual(model.tokenEmbedding[1][0], before.token);
  assert.notEqual(model.blocks[0].attn.q[0][0][0], before.q);
  assert.notEqual(model.blocks[0].ff1[0][0], before.ff);
});

test("training reduces loss on a repeated tiny sequence", () => {
  const model = new DecoderOnlyTransformer({ vocabSize: 8, contextLength: 6, dModel: 8, heads: 2, ffDim: 16, layers: 1, seed: 17 });
  const trainer = new TransformerTrainer(model, { learningRate: 0.01, weightDecay: 0, gradClip: 1 });
  const ids = [1, 2, 1, 2, 1, 2], targets = [2, 1, 2, 1, 2, 1];
  const before = loss(model, ids, targets);
  for (let i = 0; i < 30; i++) trainer.trainStep(ids, targets);
  const after = loss(model, ids, targets);
  assert.ok(after < before, `expected loss to decrease: ${before} -> ${after}`);
});

import test from "node:test";
import assert from "node:assert/strict";
import { DecoderOnlyTransformer } from "../src/ai/transformer.js";
import { makeSequences, createBatches } from "../src/ai/dataset.js";
import { ConversationMemory } from "../src/ai/memory.js";

 test("decoder transformer produces causal logits", () => {
  const model = new DecoderOnlyTransformer({ vocabSize: 32, contextLength: 16, dModel: 32, heads: 4, ffDim: 64, layers: 2 });
  const logits = model.forward([1, 2, 3, 4]);
  assert.equal(logits.length, 4);
  assert.equal(logits[0].length, 32);
  assert.ok(Number.isFinite(logits[3][7]));
});

test("dataset creates next-token sequences and batches", () => {
  const samples = makeSequences([0,1,2,3,4,5,6,7], 3);
  assert.equal(samples.length, 2);
  assert.deepEqual(samples[0], { input: [0,1,2], target: [1,2,3] });
  assert.equal(createBatches(samples, 1).length, 2);
});

test("conversation memory remains bounded", () => {
  const memory = new ConversationMemory({ maxTurns: 2 });
  memory.add("user", "one");
  memory.add("assistant", "two");
  memory.add("user", "three");
  assert.equal(memory.recent().length, 2);
  assert.equal(memory.recent()[0].content, "two");
});

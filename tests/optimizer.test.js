import test from "node:test";
import assert from "node:assert/strict";
import { AdamW } from "../src/ai/optimizer.js";

test("AdamW changes parameters and keeps finite state", () => {
  const matrix = [new Float32Array([1, -1]), new Float32Array([0.5, 2])];
  const gradient = [new Float32Array([0.2, -0.3]), new Float32Array([0.1, 0.4])];
  const before = matrix.map(row => Array.from(row));
  const optimizer = new AdamW({ learningRate: 0.01 });
  optimizer.step(matrix, gradient);
  assert.notDeepEqual(matrix.map(row => Array.from(row)), before);
  for (const row of matrix) for (const value of row) assert.ok(Number.isFinite(value));
});

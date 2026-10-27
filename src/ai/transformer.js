import { matmul, add, layerNorm, randn, relu, softmax, zeros } from "./tensor.js";

function attention(x, qW, kW, vW) {
  const q = matmul(x, qW), k = matmul(x, kW), v = matmul(x, vW);
  const d = q[0].length;
  const scores = zeros(x.length, x.length);
  for (let i = 0; i < x.length; i++) {
    for (let j = 0; j <= i; j++) {
      let s = 0;
      for (let n = 0; n < d; n++) s += q[i][n] * k[j][n];
      scores[i][j] = s / Math.sqrt(d);
    }
    for (let j = i + 1; j < x.length; j++) scores[i][j] = -Infinity;
  }
  const probs = scores.map(softmax);
  return matmul(probs, v);
}

export class MultiHeadAttention {
  constructor(dModel, heads, seed = 1) {
    if (dModel % heads !== 0) throw new Error("dModel must be divisible by heads");
    this.dModel = dModel;
    this.heads = heads;
    this.headDim = dModel / heads;
    this.q = Array.from({ length: heads }, (_, i) => randn(dModel, this.headDim, seed + i));
    this.k = Array.from({ length: heads }, (_, i) => randn(dModel, this.headDim, seed + 20 + i));
    this.v = Array.from({ length: heads }, (_, i) => randn(dModel, this.headDim, seed + 40 + i));
    this.o = randn(dModel, dModel, seed + 80);
  }

  forward(x) {
    const heads = this.q.map((q, i) => attention(x, q, this.k[i], this.v[i]));
    const merged = zeros(x.length, this.dModel);
    for (let t = 0; t < x.length; t++) {
      let p = 0;
      for (const h of heads) for (const value of h[t]) merged[t][p++] = value;
    }
    return matmul(merged, this.o);
  }
}

export class TransformerBlock {
  constructor({ dModel, heads, ffDim }, seed = 1) {
    this.dModel = dModel;
    this.attn = new MultiHeadAttention(dModel, heads, seed);
    this.ff1 = randn(dModel, ffDim, seed + 100, Math.sqrt(2 / dModel));
    this.ff2 = randn(ffDim, dModel, seed + 200, Math.sqrt(2 / ffDim));
    this.g1 = new Float32Array(dModel).fill(1);
    this.b1 = new Float32Array(dModel);
    this.g2 = new Float32Array(dModel).fill(1);
    this.b2 = new Float32Array(dModel);
  }

  forward(x) {
    const a = this.attn.forward(layerNorm(x, this.g1, this.b1));
    const r1 = add(x, a);
    const hidden = relu(matmul(layerNorm(r1, this.g2, this.b2), this.ff1));
    return add(r1, matmul(hidden, this.ff2));
  }
}

export class DecoderOnlyTransformer {
  constructor(config = {}) {
    this.vocabSize = config.vocabSize ?? 256;
    this.contextLength = config.contextLength ?? 128;
    this.dModel = config.dModel ?? 64;
    this.heads = config.heads ?? 4;
    this.ffDim = config.ffDim ?? 256;
    this.layers = config.layers ?? 2;
    this.seed = config.seed ?? 42;
    this.tokenEmbedding = randn(this.vocabSize, this.dModel, this.seed);
    this.positionEmbedding = randn(this.contextLength, this.dModel, this.seed + 1);
    this.blocks = Array.from({ length: this.layers }, (_, i) => new TransformerBlock(this, this.seed + 10 + i));
    this.lmHead = randn(this.dModel, this.vocabSize, this.seed + 500);
  }

  embed(tokenIds) {
    const ids = tokenIds.slice(-this.contextLength);
    return ids.map((id, pos) => Float32Array.from(this.tokenEmbedding[id % this.vocabSize], (v, d) => v + this.positionEmbedding[pos][d]));
  }

  forwardFeatures(tokenIds) {
    const ids = tokenIds.slice(-this.contextLength);
    let hidden = this.embed(ids);
    for (const block of this.blocks) hidden = block.forward(hidden);
    return { ids, hidden, logits: matmul(hidden, this.lmHead) };
  }

  forward(tokenIds) {
    return this.forwardFeatures(tokenIds).logits;
  }

  toJSON() {
    return { type: "astracore-decoder-transformer", version: 2, config: {
      vocabSize: this.vocabSize, contextLength: this.contextLength, dModel: this.dModel,
      heads: this.heads, ffDim: this.ffDim, layers: this.layers, seed: this.seed
    }};
  }
}

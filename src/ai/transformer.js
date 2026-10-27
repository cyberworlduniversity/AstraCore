import { matmul, randn, softmax, zeros } from "./tensor.js";

const transpose = (a) => { const out = zeros(a[0].length, a.length); for (let i = 0; i < a.length; i++) for (let j = 0; j < a[i].length; j++) out[j][i] = a[i][j]; return out; };
const zeroLike = (a) => a.map((r) => new Float32Array(r.length));
const zeroVec = (a) => new Float32Array(a.length);
const addInto = (a, b) => { for (let i = 0; i < a.length; i++) for (let j = 0; j < a[i].length; j++) a[i][j] += b[i][j]; };
const add = (a, b) => { const out = zeros(a.length, a[0].length); for (let i = 0; i < a.length; i++) for (let j = 0; j < a[i].length; j++) out[i][j] = a[i][j] + b[i][j]; return out; };
const matmulATB = (a, b) => { const out = zeros(a[0].length, b[0].length); for (let i = 0; i < a.length; i++) for (let k = 0; k < a[i].length; k++) for (let j = 0; j < b[0].length; j++) out[k][j] += a[i][k] * b[i][j]; return out; };
const matrixToJSON = (m) => m.map((r) => Array.from(r));
const vectorToJSON = (v) => Array.from(v);
const matrixFromJSON = (m) => m.map((r) => Float32Array.from(r));
const vectorFromJSON = (v) => Float32Array.from(v);

function layerNormForward(x, gamma, beta, eps = 1e-5) {
  const y = zeros(x.length, x[0].length), cache = [], n = x[0].length;
  for (let i = 0; i < x.length; i++) {
    let mean = 0; for (const v of x[i]) mean += v; mean /= n;
    let variance = 0; for (const v of x[i]) variance += (v - mean) ** 2; variance /= n;
    const inv = 1 / Math.sqrt(variance + eps), xhat = new Float32Array(n);
    for (let j = 0; j < n; j++) { xhat[j] = (x[i][j] - mean) * inv; y[i][j] = xhat[j] * gamma[j] + beta[j]; }
    cache.push({ xhat, inv });
  }
  return { y, cache };
}

function layerNormBackward(dy, cache, gamma) {
  const dx = zeros(dy.length, dy[0].length), dg = zeroVec(gamma), db = zeroVec(gamma), n = gamma.length;
  for (let i = 0; i < dy.length; i++) {
    let sum1 = 0, sum2 = 0;
    for (let j = 0; j < n; j++) { const z = dy[i][j] * gamma[j]; sum1 += z; sum2 += z * cache[i].xhat[j]; dg[j] += dy[i][j] * cache[i].xhat[j]; db[j] += dy[i][j]; }
    for (let j = 0; j < n; j++) { const z = dy[i][j] * gamma[j]; dx[i][j] = (cache[i].inv / n) * (n * z - sum1 - cache[i].xhat[j] * sum2); }
  }
  return { dx, dg, db };
}

export class MultiHeadAttention {
  constructor(dModel, heads, seed = 1) {
    if (dModel % heads) throw new Error("dModel must be divisible by heads");
    this.dModel = dModel; this.heads = heads; this.headDim = dModel / heads;
    this.q = Array.from({ length: heads }, (_, i) => randn(dModel, this.headDim, seed + i));
    this.k = Array.from({ length: heads }, (_, i) => randn(dModel, this.headDim, seed + 20 + i));
    this.v = Array.from({ length: heads }, (_, i) => randn(dModel, this.headDim, seed + 40 + i));
    this.o = randn(dModel, dModel, seed + 80);
  }
  forwardWithCache(x) {
    const T = x.length, merged = zeros(T, this.dModel), heads = [];
    for (let h = 0; h < this.heads; h++) {
      const q = matmul(x, this.q[h]), k = matmul(x, this.k[h]), v = matmul(x, this.v[h]), scores = zeros(T, T);
      for (let i = 0; i < T; i++) for (let j = 0; j <= i; j++) { let s = 0; for (let d = 0; d < this.headDim; d++) s += q[i][d] * k[j][d]; scores[i][j] = s / Math.sqrt(this.headDim); }
      const p = scores.map(softmax), o = matmul(p, v);
      for (let t = 0; t < T; t++) for (let d = 0; d < this.headDim; d++) merged[t][h * this.headDim + d] = o[t][d];
      heads.push({ q, k, v, p });
    }
    return { y: matmul(merged, this.o), merged, heads, x };
  }
  forward(x) { return this.forwardWithCache(x).y; }
  backward(c, dy) {
    const dMerged = matmul(dy, transpose(this.o)), dO = matmulATB(c.merged, dy), dx = zeros(c.x.length, this.dModel);
    const dq = this.q.map(zeroLike), dk = this.k.map(zeroLike), dv = this.v.map(zeroLike);
    for (let h = 0; h < this.heads; h++) {
      const hc = c.heads[h], T = c.x.length, dHead = zeros(T, this.headDim);
      for (let t = 0; t < T; t++) for (let d = 0; d < this.headDim; d++) dHead[t][d] = dMerged[t][h * this.headDim + d];
      const dV = matmulATB(hc.p, dHead), dP = matmul(dHead, transpose(hc.v)), dS = zeros(T, T), scale = 1 / Math.sqrt(this.headDim);
      for (let i = 0; i < T; i++) { let dot = 0; for (let j = 0; j <= i; j++) dot += dP[i][j] * hc.p[i][j]; for (let j = 0; j <= i; j++) dS[i][j] = hc.p[i][j] * (dP[i][j] - dot); }
      const dQ = matmul(dS, hc.k), dK = matmul(transpose(dS), hc.q);
      for (let i = 0; i < T; i++) for (let d = 0; d < this.headDim; d++) { dQ[i][d] *= scale; dK[i][d] *= scale; }
      dq[h] = matmulATB(c.x, dQ); dk[h] = matmulATB(c.x, dK); dv[h] = matmulATB(c.x, dV);
      addInto(dx, matmul(dQ, transpose(this.q[h]))); addInto(dx, matmul(dK, transpose(this.k[h]))); addInto(dx, matmul(dV, transpose(this.v[h])));
    }
    return { dx, dq, dk, dv, dO };
  }
}

export class TransformerBlock {
  constructor({ dModel, heads, ffDim }, seed = 1) {
    this.dModel = dModel; this.attn = new MultiHeadAttention(dModel, heads, seed);
    this.ff1 = randn(dModel, ffDim, seed + 100, Math.sqrt(2 / dModel)); this.ff2 = randn(ffDim, dModel, seed + 200, Math.sqrt(2 / ffDim));
    this.g1 = new Float32Array(dModel).fill(1); this.b1 = new Float32Array(dModel); this.g2 = new Float32Array(dModel).fill(1); this.b2 = new Float32Array(dModel);
  }
  forwardWithCache(x) {
    const n1 = layerNormForward(x, this.g1, this.b1), a = this.attn.forwardWithCache(n1.y), r1 = add(x, a.y), n2 = layerNormForward(r1, this.g2, this.b2);
    const z = matmul(n2.y, this.ff1), h = z.map((r) => Float32Array.from(r, (v) => Math.max(0, v))), fo = matmul(h, this.ff2);
    return { y: add(r1, fo), cache: { x, n1, a, r1, n2, z, h } };
  }
  forward(x) { return this.forwardWithCache(x).y; }
  backward(c, dy) {
    const dFF2 = matmulATB(c.h, dy), dH = matmul(dy, transpose(this.ff2)), dZ = dH.map((r, i) => Float32Array.from(r, (v, j) => c.z[i][j] > 0 ? v : 0));
    const dFF1 = matmulATB(c.n2.y, dZ), dN2 = matmul(dZ, transpose(this.ff1)), ln2 = layerNormBackward(dN2, c.n2.cache, this.g2);
    const dR1 = add(dy, ln2.dx), att = this.attn.backward(c.a, dR1), ln1 = layerNormBackward(att.dx, c.n1.cache, this.g1), dX = add(dy, ln1.dx);
    return { dx: dX, dff1: dFF1, dff2: dFF2, dg1: ln1.dg, db1: ln1.db, dg2: ln2.dg, db2: ln2.db, dattn: att };
  }
}

export class DecoderOnlyTransformer {
  constructor(config = {}) {
    this.vocabSize = config.vocabSize ?? 256; this.contextLength = config.contextLength ?? 128; this.dModel = config.dModel ?? 64; this.heads = config.heads ?? 4; this.ffDim = config.ffDim ?? 256; this.layers = config.layers ?? 2; this.seed = config.seed ?? 42;
    this.tokenEmbedding = randn(this.vocabSize, this.dModel, this.seed); this.positionEmbedding = randn(this.contextLength, this.dModel, this.seed + 1);
    this.blocks = Array.from({ length: this.layers }, (_, i) => new TransformerBlock(this, this.seed + 10 + i)); this.lmHead = randn(this.dModel, this.vocabSize, this.seed + 500);
  }
  embed(ids) { return ids.map((id, pos) => Float32Array.from(this.tokenEmbedding[id % this.vocabSize], (v, d) => v + this.positionEmbedding[pos][d])); }
  forwardFeatures(inputIds) { const ids = inputIds.slice(-this.contextLength); let hidden = this.embed(ids), caches = []; for (const block of this.blocks) { const r = block.forwardWithCache(hidden); hidden = r.y; caches.push(r.cache); } return { ids, hidden, logits: matmul(hidden, this.lmHead), caches }; }
  forward(ids) { return this.forwardFeatures(ids).logits; }
  backward(f, dLogits) {
    let dHidden = matmul(dLogits, transpose(this.lmHead)), dLmHead = matmulATB(f.hidden, dLogits), blockGrads = [];
    for (let i = this.blocks.length - 1; i >= 0; i--) { const g = this.blocks[i].backward(f.caches[i], dHidden); dHidden = g.dx; blockGrads[i] = g; }
    const dToken = zeroLike(this.tokenEmbedding), dPos = zeroLike(this.positionEmbedding);
    for (let t = 0; t < f.ids.length; t++) { const id = f.ids[t] % this.vocabSize; for (let d = 0; d < this.dModel; d++) { dToken[id][d] += dHidden[t][d]; dPos[t][d] += dHidden[t][d]; } }
    return { dLmHead, dToken, dPos, blockGrads };
  }
  toState() {
    return { version: 4, config: { vocabSize: this.vocabSize, contextLength: this.contextLength, dModel: this.dModel, heads: this.heads, ffDim: this.ffDim, layers: this.layers, seed: this.seed }, tokenEmbedding: matrixToJSON(this.tokenEmbedding), positionEmbedding: matrixToJSON(this.positionEmbedding), lmHead: matrixToJSON(this.lmHead), blocks: this.blocks.map((b) => ({ q: b.attn.q.map(matrixToJSON), k: b.attn.k.map(matrixToJSON), v: b.attn.v.map(matrixToJSON), o: matrixToJSON(b.attn.o), ff1: matrixToJSON(b.ff1), ff2: matrixToJSON(b.ff2), g1: vectorToJSON(b.g1), b1: vectorToJSON(b.b1), g2: vectorToJSON(b.g2), b2: vectorToJSON(b.b2) })) };
  }
  toJSON() { return { type: "astracore-decoder-transformer", version: 4, state: this.toState() }; }
  static fromState(state) {
    if (!state?.config || state.version !== 4) throw new Error("Unsupported Transformer state");
    const model = new DecoderOnlyTransformer(state.config);
    model.tokenEmbedding = matrixFromJSON(state.tokenEmbedding); model.positionEmbedding = matrixFromJSON(state.positionEmbedding); model.lmHead = matrixFromJSON(state.lmHead);
    model.blocks = state.blocks.map((s, i) => { const b = new TransformerBlock(state.config, state.config.seed + 10 + i); b.attn.q = s.q.map(matrixFromJSON); b.attn.k = s.k.map(matrixFromJSON); b.attn.v = s.v.map(matrixFromJSON); b.attn.o = matrixFromJSON(s.o); b.ff1 = matrixFromJSON(s.ff1); b.ff2 = matrixFromJSON(s.ff2); b.g1 = vectorFromJSON(s.g1); b.b1 = vectorFromJSON(s.b1); b.g2 = vectorFromJSON(s.g2); b.b2 = vectorFromJSON(s.b2); return b; });
    return model;
  }
}

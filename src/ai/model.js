function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function zeros(n) { return new Float64Array(n); }

export class NeuralLanguageModel {
  constructor({ vocabSize, embeddingDim = 32, seed = 42, learningRate = 0.03 } = {}) {
    if (!Number.isInteger(vocabSize) || vocabSize < 4) throw new Error('vocabSize must be >= 4');
    this.vocabSize = vocabSize;
    this.embeddingDim = embeddingDim;
    this.learningRate = learningRate;
    this.embeddings = new Float64Array(vocabSize * embeddingDim);
    this.output = new Float64Array(embeddingDim * vocabSize);
    this.bias = zeros(vocabSize);
    this.seed = seed;
    let state = seed >>> 0;
    const random = () => ((state = Math.imul(1664525, state) + 1013904223) >>> 0) / 4294967296;
    const scale = 0.08;
    for (let i = 0; i < this.embeddings.length; i++) this.embeddings[i] = (random() * 2 - 1) * scale;
    for (let i = 0; i < this.output.length; i++) this.output[i] = (random() * 2 - 1) * scale;
  }

  logits(tokenId) {
    if (tokenId < 0 || tokenId >= this.vocabSize) throw new RangeError('invalid tokenId');
    const logits = new Float64Array(this.vocabSize);
    const e = tokenId * this.embeddingDim;
    for (let j = 0; j < this.vocabSize; j++) {
      let sum = this.bias[j];
      const o = j;
      for (let d = 0; d < this.embeddingDim; d++) sum += this.embeddings[e + d] * this.output[d * this.vocabSize + o];
      logits[j] = sum;
    }
    return logits;
  }

  trainStep(inputId, targetId) {
    const logits = this.logits(inputId);
    let max = -Infinity;
    for (const x of logits) max = Math.max(max, x);
    const probs = new Float64Array(this.vocabSize);
    let total = 0;
    for (let i = 0; i < this.vocabSize; i++) { probs[i] = Math.exp(logits[i] - max); total += probs[i]; }
    for (let i = 0; i < this.vocabSize; i++) probs[i] /= total;

    const grad = probs;
    grad[targetId] -= 1;
    const e = inputId * this.embeddingDim;
    const oldEmbedding = this.embeddings.slice(e, e + this.embeddingDim);
    for (let j = 0; j < this.vocabSize; j++) {
      this.bias[j] -= this.learningRate * grad[j];
      for (let d = 0; d < this.embeddingDim; d++) {
        const idx = d * this.vocabSize + j;
        this.output[idx] -= this.learningRate * oldEmbedding[d] * grad[j];
        this.embeddings[e + d] -= this.learningRate * this.learningRate * this.output[idx] * grad[j];
      }
    }
    return -Math.log(Math.max(probs[targetId], 1e-12));
  }

  toJSON() {
    return {
      vocabSize: this.vocabSize,
      embeddingDim: this.embeddingDim,
      learningRate: this.learningRate,
      seed: this.seed,
      embeddings: Array.from(this.embeddings),
      output: Array.from(this.output),
      bias: Array.from(this.bias)
    };
  }

  static fromJSON(value) {
    const model = new NeuralLanguageModel(value);
    model.embeddings.set(value.embeddings);
    model.output.set(value.output);
    model.bias.set(value.bias);
    return model;
  }
}

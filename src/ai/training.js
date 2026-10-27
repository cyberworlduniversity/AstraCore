import { AdamW } from './optimizer.js';
import { softmax } from './tensor.js';

export function crossEntropy(logits, targets) {
  let loss = 0;
  for (let t = 0; t < targets.length; t++) loss -= Math.log(Math.max(softmax(logits[t])[targets[t]], 1e-12));
  return loss / Math.max(targets.length, 1);
}

export function makeLogitGradients(logits, targets) {
  const scale = 1 / Math.max(targets.length, 1);
  return logits.map((row, t) => {
    const p = softmax(row);
    const g = Float32Array.from(p, (v) => v * scale);
    g[targets[t]] -= scale;
    return g;
  });
}

function collect(model, grads) {
  const params = [
    { value: model.tokenEmbedding, gradient: grads.dToken, name: 'tokenEmbedding' },
    { value: model.positionEmbedding, gradient: grads.dPos, name: 'positionEmbedding' },
    { value: model.lmHead, gradient: grads.dLmHead, name: 'lmHead' },
  ];
  model.blocks.forEach((b, i) => {
    const g = grads.blockGrads[i];
    b.attn.q.forEach((v, h) => params.push({ value: v, gradient: g.dattn.dq[h], name: `block${i}.attn.q${h}` }));
    b.attn.k.forEach((v, h) => params.push({ value: v, gradient: g.dattn.dk[h], name: `block${i}.attn.k${h}` }));
    b.attn.v.forEach((v, h) => params.push({ value: v, gradient: g.dattn.dv[h], name: `block${i}.attn.v${h}` }));
    params.push({ value: b.attn.o, gradient: g.dattn.dO, name: `block${i}.attn.o` });
    params.push({ value: b.ff1, gradient: g.dff1, name: `block${i}.ff1` });
    params.push({ value: b.ff2, gradient: g.dff2, name: `block${i}.ff2` });
    params.push({ value: b.g1, gradient: g.dg1, name: `block${i}.g1` });
    params.push({ value: b.b1, gradient: g.db1, name: `block${i}.b1` });
    params.push({ value: b.g2, gradient: g.dg2, name: `block${i}.g2` });
    params.push({ value: b.b2, gradient: g.db2, name: `block${i}.b2` });
  });
  return params;
}

export function clipGradients(parameters, maxNorm = 1) {
  let sum = 0;
  for (const { gradient } of parameters) {
    if (ArrayBuffer.isView(gradient)) for (const g of gradient) sum += g * g;
    else for (const row of gradient) for (const g of row) sum += g * g;
  }
  const norm = Math.sqrt(sum);
  const scale = norm > maxNorm ? maxNorm / (norm + 1e-12) : 1;
  if (scale < 1) for (const { gradient } of parameters) {
    if (ArrayBuffer.isView(gradient)) for (let i = 0; i < gradient.length; i++) gradient[i] *= scale;
    else for (const row of gradient) for (let i = 0; i < row.length; i++) row[i] *= scale;
  }
  return { norm, scale };
}

export class TransformerTrainer {
  constructor(model, { learningRate = 3e-4, weightDecay = 0.01, maxGradNorm = 1 } = {}) {
    this.model = model;
    this.optimizer = new AdamW({ learningRate, weightDecay });
    this.maxGradNorm = maxGradNorm;
    this.step = 0;
  }
  trainSample(inputIds, targetIds) {
    const features = this.model.forwardFeatures(inputIds);
    const targets = targetIds.slice(-features.ids.length);
    const loss = crossEntropy(features.logits, targets);
    const gradients = this.model.backward(features, makeLogitGradients(features.logits, targets));
    const parameters = collect(this.model, gradients);
    const clip = clipGradients(parameters, this.maxGradNorm);
    this.optimizer.stepMany(parameters);
    this.step += 1;
    return { loss, gradNorm: clip.norm, clipped: clip.scale < 1, step: this.step };
  }
  evaluate(samples) {
    if (!samples.length) return { loss: 0, tokens: 0, perplexity: 1 };
    let total = 0, tokens = 0;
    for (const sample of samples) {
      const f = this.model.forwardFeatures(sample.input);
      const targets = sample.target.slice(-f.ids.length);
      total += crossEntropy(f.logits, targets) * targets.length;
      tokens += targets.length;
    }
    const loss = total / Math.max(tokens, 1);
    return { loss, tokens, perplexity: Math.exp(Math.min(loss, 20)) };
  }
  train(samples, { epochs = 1, validation = [], onStep } = {}) {
    const history = [];
    for (let epoch = 1; epoch <= epochs; epoch++) {
      let trainLoss = 0;
      for (const sample of samples) {
        const result = this.trainSample(sample.input, sample.target);
        trainLoss += result.loss;
        onStep?.({ epoch, ...result });
      }
      const validationResult = this.evaluate(validation);
      history.push({ epoch, trainLoss: trainLoss / Math.max(samples.length, 1), validation: validationResult, step: this.step });
    }
    return history;
  }
}

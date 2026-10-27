import { AdamW } from './optimizer.js';
import { softmax } from './tensor.js';

export function crossEntropy(logits, targets) {
  let loss = 0;
  for (let t = 0; t < targets.length; t++) loss -= Math.log(Math.max(softmax(logits[t])[targets[t]], 1e-12));
  return loss / Math.max(targets.length, 1);
}
export function makeLogitGradients(logits, targets) {
  const scale = 1 / Math.max(targets.length, 1);
  return logits.map((row, t) => { const p = softmax(row); const g = Float32Array.from(p, (v) => v * scale); g[targets[t]] -= scale; return g; });
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
    params.push({ value: b.attn.o, gradient: g.dattn.dO, name: `block${i}.attn.o` }, { value: b.ff1, gradient: g.dff1, name: `block${i}.ff1` }, { value: b.ff2, gradient: g.dff2, name: `block${i}.ff2` }, { value: b.g1, gradient: g.dg1, name: `block${i}.g1` }, { value: b.b1, gradient: g.db1, name: `block${i}.b1` }, { value: b.g2, gradient: g.dg2, name: `block${i}.g2` }, { value: b.b2, gradient: g.db2, name: `block${i}.b2` });
  });
  return params;
}
function optimizerParameters(model) {
  return collect(model, { dToken: model.tokenEmbedding.map(r => new Float32Array(r.length)), dPos: model.positionEmbedding.map(r => new Float32Array(r.length)), dLmHead: model.lmHead.map(r => new Float32Array(r.length)), blockGrads: model.blocks.map(b => ({ dattn: { dq: b.attn.q.map(v => v.map(r => new Float32Array(r.length))), dk: b.attn.k.map(v => v.map(r => new Float32Array(r.length))), dv: b.attn.v.map(v => v.map(r => new Float32Array(r.length))), dO: b.attn.o.map(r => new Float32Array(r.length)) }, dff1: b.ff1.map(r => new Float32Array(r.length)), dff2: b.ff2.map(r => new Float32Array(r.length)), dg1: new Float32Array(b.g1.length), db1: new Float32Array(b.b1.length), dg2: new Float32Array(b.g2.length), db2: new Float32Array(b.b2.length) })) });
}
export function clipGradients(parameters, maxNorm = 1) {
  let sum = 0; for (const { gradient } of parameters) { if (ArrayBuffer.isView(gradient)) for (const g of gradient) sum += g * g; else for (const row of gradient) for (const g of row) sum += g * g; }
  const norm = Math.sqrt(sum), scale = norm > maxNorm ? maxNorm / (norm + 1e-12) : 1;
  if (scale < 1) for (const { gradient } of parameters) { if (ArrayBuffer.isView(gradient)) for (let i = 0; i < gradient.length; i++) gradient[i] *= scale; else for (const row of gradient) for (let i = 0; i < row.length; i++) row[i] *= scale; }
  return { norm, scale };
}
export function perplexity(loss) { return Math.exp(Math.min(loss, 50)); }

export class TransformerTrainer {
  constructor(model, { learningRate = 3e-4, weightDecay = 0.01, maxGradNorm = 1, gradClip = maxGradNorm } = {}) {
    this.model = model; this.optimizer = new AdamW({ learningRate, weightDecay }); this.maxGradNorm = gradClip; this.step = 0; this.steps = 0;
  }
  trainSample(inputIds, targetIds) {
    const features = this.model.forwardFeatures(inputIds), targets = targetIds.slice(-features.ids.length);
    if (!targets.length) throw new Error('Training sample must contain at least one target token');
    const loss = crossEntropy(features.logits, targets), gradients = this.model.backward(features, makeLogitGradients(features.logits, targets));
    const parameters = collect(this.model, gradients), clip = clipGradients(parameters, this.maxGradNorm); this.optimizer.stepMany(parameters); this.step += 1; this.steps = this.step;
    return { loss, gradNorm: clip.norm, gradientNorm: clip.norm, clipped: clip.scale < 1, step: this.step, steps: this.steps };
  }
  trainStep(inputIds, targetIds) { return this.trainSample(inputIds, targetIds); }
  evaluate(samples) {
    if (!samples.length) return { loss: 0, tokens: 0, perplexity: 1 };
    let total = 0, tokens = 0; for (const sample of samples) { const f = this.model.forwardFeatures(sample.input), targets = sample.target.slice(-f.ids.length); total += crossEntropy(f.logits, targets) * targets.length; tokens += targets.length; }
    const loss = total / Math.max(tokens, 1); return { loss, tokens, perplexity: perplexity(loss) };
  }
  train(samples, { epochs = 1, validation = [], onStep } = {}) {
    const history = []; for (let epoch = 1; epoch <= epochs; epoch++) { let trainLoss = 0; for (const sample of samples) { const result = this.trainSample(sample.input, sample.target); trainLoss += result.loss; onStep?.({ epoch, ...result }); } const validationResult = this.evaluate(validation); history.push({ epoch, trainLoss: trainLoss / Math.max(samples.length, 1), validation: validationResult, step: this.step }); } return history;
  }
  toJSON() { return { version: 1, step: this.step, steps: this.steps, maxGradNorm: this.maxGradNorm, optimizer: this.optimizer.toJSON(optimizerParameters(this.model)) }; }
  static fromJSON(model, data) {
    if (!data || data.version !== 1) throw new Error('Unsupported trainer state');
    const trainer = new TransformerTrainer(model, { learningRate: data.optimizer.config.learningRate, weightDecay: data.optimizer.config.weightDecay, maxGradNorm: data.maxGradNorm });
    trainer.step = data.step; trainer.steps = data.steps; trainer.optimizer.loadJSON(data.optimizer, optimizerParameters(model)); return trainer;
  }
}

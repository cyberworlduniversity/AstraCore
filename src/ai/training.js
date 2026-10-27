import { softmax, zeros } from "./tensor.js";
import { AdamW } from "./optimizer.js";

function crossEntropy(logits, target) { const probs = softmax(logits); return { loss: -Math.log(Math.max(probs[target], 1e-12)), probs }; }
function scaleMatrix(g, s) { for (const row of g) for (let j = 0; j < row.length; j++) row[j] *= s; }
function scaleVec(g, s) { for (let i = 0; i < g.length; i++) g[i] *= s; }

export class TransformerTrainer {
  constructor(model, { learningRate = 1e-3, weightDecay = 0.01, gradClip = 1 } = {}) { this.model = model; this.optimizer = new AdamW({ learningRate, weightDecay }); this.steps = 0; this.gradClip = gradClip; }
  trainStep(inputIds, targetIds) {
    const features = this.model.forwardFeatures(inputIds), dLogits = zeros(features.logits.length, this.model.vocabSize);
    let loss = 0; const count = Math.min(features.logits.length, targetIds.length);
    if (!count) throw new Error("Training sample must contain at least one target token");
    for (let t = 0; t < count; t++) { const target = ((targetIds[t] % this.model.vocabSize) + this.model.vocabSize) % this.model.vocabSize; const result = crossEntropy(features.logits[t], target); loss += result.loss; for (let v = 0; v < this.model.vocabSize; v++) dLogits[t][v] = result.probs[v]; dLogits[t][target] -= 1; }
    scaleMatrix(dLogits, 1 / count);
    const g = this.model.backward(features, dLogits);
    const parameters = [{ value: this.model.lmHead, gradient: g.dLmHead }, { value: this.model.tokenEmbedding, gradient: g.dToken }, { value: this.model.positionEmbedding, gradient: g.dPos }];
    for (let i = 0; i < this.model.blocks.length; i++) {
      const block = this.model.blocks[i], bg = g.blockGrads[i];
      parameters.push({ value: block.ff1, gradient: bg.dff1 }, { value: block.ff2, gradient: bg.dff2 }, { value: block.g1, gradient: bg.dg1 }, { value: block.b1, gradient: bg.db1 }, { value: block.g2, gradient: bg.dg2 }, { value: block.b2, gradient: bg.db2 }, { value: block.attn.o, gradient: bg.dattn.dO });
      for (let h = 0; h < block.attn.heads; h++) parameters.push({ value: block.attn.q[h], gradient: bg.dattn.dq[h] }, { value: block.attn.k[h], gradient: bg.dattn.dk[h] }, { value: block.attn.v[h], gradient: bg.dattn.dv[h] });
    }
    let norm = 0; for (const p of parameters) { if (ArrayBuffer.isView(p.gradient)) for (const v of p.gradient) norm += v * v; else for (const row of p.gradient) for (const v of row) norm += v * v; } norm = Math.sqrt(norm);
    const scale = norm > this.gradClip ? this.gradClip / norm : 1;
    if (scale !== 1) for (const p of parameters) ArrayBuffer.isView(p.gradient) ? scaleVec(p.gradient, scale) : scaleMatrix(p.gradient, scale);
    this.optimizer.stepMany(parameters); this.steps += 1;
    return { loss: loss / count, steps: this.steps, gradientNorm: norm, clipped: scale !== 1 };
  }
}

export function perplexity(loss) { return Math.exp(Math.min(loss, 50)); }

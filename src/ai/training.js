import { softmax, zeros } from "./tensor.js";
import { AdamW } from "./optimizer.js";

function crossEntropy(logits, target) {
  const probs = softmax(logits);
  return { loss: -Math.log(Math.max(probs[target], 1e-12)), probs };
}

export class TransformerTrainer {
  constructor(model, { learningRate = 1e-3, weightDecay = 0.01 } = {}) {
    this.model = model;
    this.optimizer = new AdamW({ learningRate, weightDecay });
    this.steps = 0;
  }

  trainStep(inputIds, targetIds) {
    const { hidden, logits } = this.model.forwardFeatures(inputIds);
    const grad = zeros(this.model.dModel, this.model.vocabSize);
    let loss = 0;
    let count = 0;

    const limit = Math.min(logits.length, targetIds.length);
    for (let t = 0; t < limit; t++) {
      const target = targetIds[t] % this.model.vocabSize;
      const result = crossEntropy(logits[t], target);
      loss += result.loss;
      count += 1;
      for (let d = 0; d < this.model.dModel; d++) {
        for (let v = 0; v < this.model.vocabSize; v++) {
          grad[d][v] += hidden[t][d] * result.probs[v];
        }
        grad[d][target] -= hidden[t][d];
      }
    }

    if (!count) throw new Error("Training sample must contain at least one target token");
    for (let d = 0; d < grad.length; d++) for (let v = 0; v < grad[d].length; v++) grad[d][v] /= count;
    this.optimizer.step(this.model.lmHead, grad);
    this.steps += 1;
    return { loss: loss / count, steps: this.steps };
  }
}

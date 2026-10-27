export class AdamW {
  constructor({ learningRate = 1e-3, beta1 = 0.9, beta2 = 0.999, epsilon = 1e-8, weightDecay = 0.01 } = {}) {
    this.learningRate = learningRate; this.beta1 = beta1; this.beta2 = beta2; this.epsilon = epsilon; this.weightDecay = weightDecay; this.stepCount = 0; this.state = new WeakMap();
  }
  _state(value, factory) { let state = this.state.get(value); if (!state) { state = { m: factory(), v: factory() }; this.state.set(value, state); } return state; }
  stepMany(parameters) {
    this.stepCount += 1; const b1t = 1 - this.beta1 ** this.stepCount, b2t = 1 - this.beta2 ** this.stepCount;
    for (const { value, gradient } of parameters) {
      if (ArrayBuffer.isView(value)) {
        const state = this._state(value, () => new Float32Array(value.length));
        for (let i = 0; i < value.length; i++) { const g = gradient[i]; state.m[i] = this.beta1 * state.m[i] + (1 - this.beta1) * g; state.v[i] = this.beta2 * state.v[i] + (1 - this.beta2) * g * g; value[i] -= this.learningRate * (state.m[i] / b1t / (Math.sqrt(state.v[i] / b2t) + this.epsilon) + this.weightDecay * value[i]); }
      } else {
        const state = this._state(value, () => value.map(row => new Float32Array(row.length)));
        for (let i = 0; i < value.length; i++) for (let j = 0; j < value[i].length; j++) { const g = gradient[i][j]; state.m[i][j] = this.beta1 * state.m[i][j] + (1 - this.beta1) * g; state.v[i][j] = this.beta2 * state.v[i][j] + (1 - this.beta2) * g * g; value[i][j] -= this.learningRate * (state.m[i][j] / b1t / (Math.sqrt(state.v[i][j] / b2t) + this.epsilon) + this.weightDecay * value[i][j]); }
      }
    }
  }
  step(matrix, gradient) { this.stepMany([{ value: matrix, gradient }]); }
}

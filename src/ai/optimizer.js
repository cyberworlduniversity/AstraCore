export class AdamW {
  constructor({ learningRate = 1e-3, beta1 = 0.9, beta2 = 0.999, epsilon = 1e-8, weightDecay = 0.01 } = {}) {
    this.learningRate = learningRate;
    this.beta1 = beta1;
    this.beta2 = beta2;
    this.epsilon = epsilon;
    this.weightDecay = weightDecay;
    this.stepCount = 0;
    this.state = new WeakMap();
  }

  step(matrix, gradient) {
    let state = this.state.get(matrix);
    if (!state) {
      state = { m: matrix.map(row => new Float32Array(row.length)), v: matrix.map(row => new Float32Array(row.length)) };
      this.state.set(matrix, state);
    }
    this.stepCount += 1;
    const b1t = 1 - this.beta1 ** this.stepCount;
    const b2t = 1 - this.beta2 ** this.stepCount;
    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < matrix[i].length; j++) {
        const g = gradient[i][j];
        state.m[i][j] = this.beta1 * state.m[i][j] + (1 - this.beta1) * g;
        state.v[i][j] = this.beta2 * state.v[i][j] + (1 - this.beta2) * g * g;
        const mHat = state.m[i][j] / b1t;
        const vHat = state.v[i][j] / b2t;
        matrix[i][j] -= this.learningRate * (mHat / (Math.sqrt(vHat) + this.epsilon) + this.weightDecay * matrix[i][j]);
      }
    }
  }
}

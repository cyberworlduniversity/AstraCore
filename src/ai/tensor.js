export function zeros(rows, cols) {
  return Array.from({ length: rows }, () => new Float32Array(cols));
}

export function randn(rows, cols, seed = 1, scale = 0.02) {
  let s = seed >>> 0;
  const next = () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const out = zeros(rows, cols);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const u = Math.max(next(), 1e-7);
      const v = next();
      out[i][j] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * scale;
    }
  }
  return out;
}

export function matmul(a, b) {
  const out = zeros(a.length, b[0].length);
  for (let i = 0; i < a.length; i++) {
    for (let k = 0; k < b.length; k++) {
      const av = a[i][k];
      for (let j = 0; j < b[0].length; j++) out[i][j] += av * b[k][j];
    }
  }
  return out;
}

export function add(a, b) {
  return a.map((row, i) => Float32Array.from(row, (v, j) => v + b[i][j]));
}

export function softmax(row) {
  let max = -Infinity;
  for (const v of row) max = Math.max(max, v);
  const e = Float32Array.from(row, v => Math.exp(v - max));
  let sum = 0;
  for (const v of e) sum += v;
  return Float32Array.from(e, v => v / sum);
}

export function layerNorm(x, gamma, beta, eps = 1e-5) {
  const out = zeros(x.length, x[0].length);
  for (let i = 0; i < x.length; i++) {
    let mean = 0;
    for (const v of x[i]) mean += v;
    mean /= x[i].length;
    let variance = 0;
    for (const v of x[i]) variance += (v - mean) ** 2;
    variance /= x[i].length;
    const inv = 1 / Math.sqrt(variance + eps);
    for (let j = 0; j < x[i].length; j++) out[i][j] = (x[i][j] - mean) * inv * gamma[j] + beta[j];
  }
  return out;
}

export function relu(x) {
  return x.map(row => Float32Array.from(row, v => Math.max(0, v)));
}

function softmax(logits, temperature = 1) {
  const t = Math.max(temperature, 1e-4);
  let max = -Infinity;
  for (const x of logits) max = Math.max(max, x / t);
  const probs = Float64Array.from(logits, x => Math.exp(x / t - max));
  let sum = 0;
  for (const p of probs) sum += p;
  for (let i = 0; i < probs.length; i++) probs[i] /= sum;
  return probs;
}

function sample(probs, { topK = 0, rng = Math.random } = {}) {
  const candidates = Array.from(probs, (p, id) => ({ id, p }))
    .filter(x => x.p > 0)
    .sort((a, b) => b.p - a.p);
  const selected = topK > 0 ? candidates.slice(0, topK) : candidates;
  let total = 0;
  for (const c of selected) total += c.p;
  let r = rng() * total;
  for (const c of selected) { r -= c.p; if (r <= 0) return c.id; }
  return selected.at(-1)?.id ?? 0;
}

export function generate(model, tokenizer, prompt, options = {}) {
  const {
    maxNewTokens = 80,
    temperature = 0.8,
    topK = 8,
    stopOnEos = true,
    rng = Math.random
  } = options;
  const ids = tokenizer.encode(prompt, { addBos: true, addEos: false });
  for (let step = 0; step < maxNewTokens; step++) {
    const next = sample(softmax(model.logits(ids.at(-1)), temperature), { topK, rng });
    ids.push(next);
    if (stopOnEos && next === tokenizer.special.EOS) break;
  }
  return { text: tokenizer.decode(ids), tokenIds: ids };
}

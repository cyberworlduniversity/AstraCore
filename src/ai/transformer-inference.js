import { softmax } from './tensor.js';

function sample(logits, temperature = 0.8, topK = 8, random = Math.random) {
  const temp = Math.min(Math.max(Number(temperature) || 0.8, 0.1), 2);
  const k = Math.max(1, Math.min(Number(topK) || 8, logits.length));
  const scaled = logits.map((v) => v / temp);
  const ranked = scaled.map((score, id) => ({ id, score })).sort((a, b) => b.score - a.score).slice(0, k);
  const probs = softmax(ranked.map((x) => x.score));
  let r = Math.min(Math.max(Number(random()), 0), 0.999999999);
  for (let i = 0; i < probs.length; i++) { r -= probs[i]; if (r <= 0) return ranked[i].id; }
  return ranked[ranked.length - 1].id;
}

export function generateWithTransformer(model, tokenizer, prompt, options = {}) {
  const maxNewTokens = Math.min(Math.max(Number(options.maxNewTokens) || 80, 1), 160);
  let state = tokenizer.encode(prompt, { addBos: true, addEos: false }).slice(-model.contextLength);
  const generated = [];
  for (let i = 0; i < maxNewTokens; i++) {
    const logits = model.forward(state);
    const next = sample(logits[logits.length - 1], options.temperature, options.topK, options.random ?? Math.random);
    generated.push(next);
    state = [...state, next].slice(-model.contextLength);
    if (next === tokenizer.special.EOS) break;
  }
  return { text: tokenizer.decode(generated), tokenIds: generated };
}

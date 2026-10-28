import { softmax } from './tensor.js';

function sample(logits, temperature = 0.8, topK = 8, random = Math.random) {
  const scaled = logits.map((v) => v / Math.max(temperature, 0.05));
  const ranked = scaled.map((score, id) => ({ id, score })).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(topK, scaled.length)));
  const probs = softmax(ranked.map((x) => x.score));
  let r = random();
  for (let i = 0; i < probs.length; i++) { r -= probs[i]; if (r <= 0) return ranked[i].id; }
  return ranked[ranked.length - 1].id;
}

export function generateWithTransformer(model, tokenizer, prompt, options = {}) {
  const maxNewTokens = Math.min(Math.max(Number(options.maxNewTokens) || 80, 1), 160);
  const temperature = Number(options.temperature) || 0.8;
  const topK = Number(options.topK) || 8;
  let state = tokenizer.encode(prompt).slice(-model.contextLength);
  const generated = [];
  for (let i = 0; i < maxNewTokens; i++) {
    const logits = model.forward(state);
    const next = sample(logits[logits.length - 1], temperature, topK, options.random);
    generated.push(next);
    state = [...state, next].slice(-model.contextLength);
    if (tokenizer.eosId !== undefined && next === tokenizer.eosId) break;
  }
  return { text: tokenizer.decode(generated), tokenIds: generated };
}

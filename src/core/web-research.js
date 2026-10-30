import { redactSecrets } from './safety-layer.js';

export function createResearchPlan(question, { maxSources = 8 } = {}) {
  return { question: String(question).slice(0, 4000), stages: ['search','fetch','extract','verify','rank','cite','synthesize'], maxSources: Math.min(Math.max(Number(maxSources) || 8, 1), 20) };
}

export async function runResearch(question, adapters = {}, options = {}) {
  const plan = createResearchPlan(question, options);
  if (typeof adapters.search !== 'function') return { status: 'not_implemented', plan, sources: [], answer: null };
  const searchResults = await adapters.search(plan.question, { limit: plan.maxSources });
  const fetched = typeof adapters.fetch === 'function' ? await Promise.all(searchResults.slice(0, plan.maxSources).map((item) => adapters.fetch(item.url))) : [];
  const sources = fetched.map((item, index) => ({ source_id: item.id || `web-${index + 1}`, title: item.title || searchResults[index]?.title || 'Web source', url: item.url || searchResults[index]?.url || null, content: redactSecrets(String(item.content || '').slice(0, 10000)) })).filter((item) => item.content);
  return { status: 'retrieved', plan, sources, answer: null };
}

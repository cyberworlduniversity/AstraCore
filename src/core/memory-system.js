import crypto from 'node:crypto';

export function normalizeMemory(input) {
  return {
    content: String(input.content || '').slice(0, 8000),
    kind: input.kind || 'preference',
    consent: input.consent === true,
    importance: Math.min(Math.max(Number(input.importance) || 0.5, 0), 1),
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  };
}

export function memoryId(content) {
  return crypto.createHash('sha256').update(String(content)).digest('hex');
}

export function selectRelevantMemories(memories = [], query = '', limit = 8) {
  const terms = String(query).toLowerCase().split(/\W+/).filter(Boolean);
  return memories.filter(m => m?.consent === true).map(m => {
    const text = String(m.content || '').toLowerCase();
    const hits = terms.reduce((n,t) => n + (text.includes(t) ? 1 : 0), 0);
    return { ...m, relevance: hits / Math.max(terms.length, 1) * 0.7 + Number(m.importance || 0) * 0.3 };
  }).sort((a,b) => b.relevance - a.relevance).slice(0, limit);
}

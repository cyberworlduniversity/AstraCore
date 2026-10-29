const MAX_QUERY_LENGTH = 2000;

const PATTERNS = {
  web_search: /\b(latest|current|today|tonight|recent|this week|this month|breaking|price|weather|sports|news|release|regulation)\b/i,
  file_search: /\b(uploaded|upload|pdf|document|file|my notes|my knowledge|chapter|page)\b/i,
  memory: /\b(remember|forgot|forget|what did i tell you|my preference|last week)\b/i,
  calculator: /(?:\bcalculate\b|\bcompute\b|\b\d+\s*[+\-*x×/]\s*\d+)/i,
  code_execution: /\b(run|execute)\b.{0,40}\b(python|code|program|script)\b/i,
  data_analysis: /\b(analy[sz]e|analysis|csv|spreadsheet|excel|statistics|dataset)\b/i,
};

export function normalizeQuery(query) {
  return String(query || '').trim().slice(0, MAX_QUERY_LENGTH);
}

export function classifyRequest(query, { explicitSource = null } = {}) {
  const normalized = normalizeQuery(query);
  if (explicitSource) return explicitSource;
  if (PATTERNS.memory.test(normalized)) return 'memory';
  if (PATTERNS.file_search.test(normalized)) return 'file_search';
  if (PATTERNS.web_search.test(normalized)) return 'web_search';
  if (PATTERNS.code_execution.test(normalized)) return 'code_execution';
  if (PATTERNS.data_analysis.test(normalized)) return 'data_analysis';
  if (PATTERNS.calculator.test(normalized)) return 'calculator';
  return 'model';
}

export function buildPlan(query, options = {}) {
  const intent = classifyRequest(query, options);
  const plan = { intent, steps: ['understand'] };
  if (intent === 'file_search') plan.steps.push('retrieve_user_knowledge', 'verify_sources');
  else if (intent === 'web_search') plan.steps.push('web_retrieval', 'verify_sources');
  else if (intent === 'memory') plan.steps.push('retrieve_memory', 'verify_permissions');
  else if (intent === 'calculator') plan.steps.push('deterministic_calculation');
  else if (intent === 'code_execution') plan.steps.push('sandboxed_execution', 'verify_result');
  else if (intent === 'data_analysis') plan.steps.push('structured_data_tool');
  plan.steps.push('generate_response', 'safety_check');
  return plan;
}

import { rankAndDedupeSources, selectMemories, buildBoundedContext } from './production-pipeline.js';
import { selectRelevantMemories } from './memory-system.js';
import { authorizeTool, isolateUntrustedContent } from './step16-27.js';

export function buildRagContext({ query, knowledge = [], memories = [], extra = '' } = {}) {
  const rankedKnowledge = rankAndDedupeSources(knowledge, 12);
  const consentedMemories = selectRelevantMemories(memories, query, 8);
  const selected = selectMemories(consentedMemories, 8);
  const context = buildBoundedContext({
    query,
    knowledge: rankedKnowledge,
    memories: selected,
    extra,
  });
  return Object.freeze({ knowledge: rankedKnowledge, memories: selected, context });
}

export function buildToolRegistry(rows = []) {
  return new Map(rows.filter(Boolean).map((tool) => [tool.name, Object.freeze({
    ...tool,
    risk: tool.risk || tool.risk_level || 'low',
    enabled: tool.status === 'enabled' || tool.enabled === true,
    timeout_ms: Math.min(Math.max(Number(tool.timeout_ms) || 10000, 1000), 120000),
  })]));
}

export async function executeTool(name, args, { registry, executors = {}, request = {} } = {}) {
  const tool = registry?.get(name);
  const authorization = authorizeTool(tool, request);
  if (!authorization.allowed) return { ok: false, tool: name, error: authorization.reason };
  const executor = executors[name];
  if (typeof executor !== 'function') return { ok: false, tool: name, error: 'executor_not_registered' };

  const timeout = tool.timeout_ms;
  const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('tool_timeout')), timeout));
  try {
    const result = await Promise.race([Promise.resolve(executor(args)), timer]);
    return { ok: true, tool: name, result: isolateUntrustedContent(JSON.stringify(result ?? null)) };
  } catch (error) {
    return { ok: false, tool: name, error: error instanceof Error ? error.message : 'tool_failed' };
  }
}

export function buildAgentLoop({ tasks = [], maxSteps = 8 } = {}) {
  return tasks.slice(0, Math.min(Math.max(Number(maxSteps) || 8, 1), 16)).map((task, index) => Object.freeze({
    id: task.id || `agent-step-${index + 1}`,
    role: task.role || 'analyst',
    input: String(task.input || '').slice(0, 4000),
    dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
    status: 'planned',
  }));
}

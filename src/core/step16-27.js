// AstraCore Steps 16-27 capability contracts and production orchestration helpers.
// These modules are provider-independent: no commercial model is required.

export const STEP_CAPABILITIES = Object.freeze({
  16: 'astracore_embed_training',
  17: 'astracore_lm_training',
  18: 'full_rag_intelligence',
  19: 'memory_system',
  20: 'tool_agent_system',
  21: 'multimodal_intelligence',
  22: 'web_research',
  23: 'coding_intelligence',
  24: 'agent_orchestration',
  25: 'safety_layer',
  26: 'production_evaluation',
  27: 'final_architecture',
});

export const STEP_STATES = Object.freeze(['enabled','experimental','disabled','not_implemented','training','evaluation_failed','ready']);

export function capabilityState(name, status, metadata = {}) {
  if (!STEP_STATES.includes(status)) throw new Error(`Invalid capability state: ${status}`);
  return Object.freeze({ name, status, ...metadata });
}

export function buildIntelligenceGraph({ router, retrieval, memory, tools, agents, model, safety }) {
  return Object.freeze({ router, retrieval, memory, tools, agents, model, safety });
}

export function buildAgentPlan(tasks = []) {
  return tasks.map((task, index) => Object.freeze({
    id: task.id || `task-${index + 1}`,
    role: task.role || 'analyst',
    input: String(task.input || ''),
    dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
    risk: task.risk || 'low',
    status: 'planned',
  }));
}

export function authorizeTool(tool, request = {}) {
  if (!tool || tool.enabled !== true) return { allowed: false, reason: 'tool_disabled' };
  if (tool.requires_admin && request.isAdmin !== true) return { allowed: false, reason: 'admin_required' };
  const risk = tool.risk || 'low';
  if (risk === 'high' && request.explicitApproval !== true) return { allowed: false, reason: 'explicit_approval_required' };
  return { allowed: true, reason: 'authorized' };
}

export function isolateUntrustedContent(content) {
  return `[[UNTRUSTED_CONTENT_START]]\n${String(content || '').slice(0, 16000)}\n[[UNTRUSTED_CONTENT_END]]`;
}

export function productionScore(metrics = {}) {
  const keys = ['accuracy','retrieval_recall','groundedness','tool_success','memory_accuracy','multilingual'];
  const values = keys.map(k => Number(metrics[k])).filter(Number.isFinite);
  return values.length ? values.reduce((a,b) => a + b, 0) / values.length : 0;
}

export function finalArchitecture() {
  return Object.freeze({
    core: ['AstraCoreLM','AstraCoreEmbed'],
    intelligence: ['memory','knowledge','tools'],
    agents: ['web','files','code','researcher','coder','analyst','security'],
    safety: ['prompt_injection','authorization','untrusted_content','secrets','audit'],
    api: ['POST /api/chat'],
    ui: ['mobile_first','conversation_history','capability_status'],
  });
}

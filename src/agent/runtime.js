const MAX_TASK_CHARS = 4000;
const MAX_STEPS = 8;
const MAX_STEP_CHARS = 500;
const ALLOWED_AGENT_TYPES = new Set(['general', 'research', 'coding', 'data', 'knowledge']);

function cleanText(value, max) {
  return String(value ?? '').replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]/g, '').trim().slice(0, max);
}

/** Persist a non-executing plan until a model-backed planner and sandbox exist. */
export function createAgentPlan({ task, steps = [], agentType = 'general' } = {}) {
  const normalizedTask = cleanText(task, MAX_TASK_CHARS);
  if (!normalizedTask) throw Object.assign(new Error('A non-empty task is required.'), { status: 400 });
  const normalizedType = ALLOWED_AGENT_TYPES.has(agentType) ? agentType : 'general';
  const normalizedSteps = Array.isArray(steps)
    ? steps.slice(0, MAX_STEPS).map((step) => cleanText(step, MAX_STEP_CHARS)).filter(Boolean)
    : [];
  return { version: 'agent-plan-v1', agent_type: normalizedType, task: normalizedTask, steps: normalizedSteps, created_by: 'user_supplied_plan', execution_policy: 'plan_only', tools_authorized: false };
}

/** Fail-closed authorization check. This evaluates policy; it never runs a tool. */
export function authorizeToolExecution({ registryEntry, userApproved = false, adapterAvailable = false, sandboxReady = false } = {}) {
  if (!registryEntry || typeof registryEntry !== 'object') return { allowed: false, reason: 'tool_not_registered' };
  if (registryEntry.status !== 'active') return { allowed: false, reason: 'tool_not_active' };
  if (!adapterAvailable) return { allowed: false, reason: 'tool_adapter_missing' };
  const risk = String(registryEntry.risk_level || 'high').toLowerCase();
  if (!['low', 'medium', 'high'].includes(risk)) return { allowed: false, reason: 'unknown_risk_level' };
  if (risk === 'high' && !sandboxReady) return { allowed: false, reason: 'high_risk_sandbox_required' };
  if (risk !== 'low' && !userApproved) return { allowed: false, reason: 'explicit_user_approval_required' };
  const timeout = Number(registryEntry.timeout_ms);
  if (!Number.isFinite(timeout) || timeout < 100 || timeout > 30000) return { allowed: false, reason: 'invalid_tool_timeout' };
  return { allowed: true, reason: 'policy_checks_passed', timeout_ms: timeout };
}

export const AGENT_PLAN_LIMITS = Object.freeze({ task_chars: MAX_TASK_CHARS, steps: MAX_STEPS, step_chars: MAX_STEP_CHARS });

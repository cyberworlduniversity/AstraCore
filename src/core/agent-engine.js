import { createAgentPlan } from '../agent/runtime.js';

export const AGENT_ROLES = Object.freeze(['planner', 'researcher', 'coder', 'analyst', 'document', 'security', 'browser']);

const ROLE_TYPES = Object.freeze({
  planner: 'general',
  researcher: 'research',
  coder: 'coding',
  analyst: 'data',
  document: 'knowledge',
  security: 'general',
  browser: 'research',
});

/**
 * Safe planning facade. Tool execution stays disabled until a real isolated
 * executor, cancellation support, and end-to-end authorization are available.
 */
export class AgentEngine {
  constructor({ maxSteps = 8 } = {}) {
    this.maxSteps = Math.min(Math.max(Number(maxSteps) || 8, 1), 8);
  }

  plan(task, role = 'planner') {
    if (!AGENT_ROLES.includes(role)) {
      throw Object.assign(new Error('Unknown agent role'), { status: 400 });
    }
    const plan = createAgentPlan({ task, agentType: ROLE_TYPES[role] });
    return {
      ...plan,
      role,
      steps: [
        { action: 'understand', task: plan.task },
        { action: 'verify' },
        { action: 'respond' },
      ].slice(0, this.maxSteps),
    };
  }

  async run({ task, role = 'planner', tools = [] } = {}) {
    const plan = this.plan(task, role);
    const requestedTools = Array.isArray(tools) ? tools.slice(0, this.maxSteps).map(String) : [];
    return {
      plan,
      results: [],
      status: requestedTools.length ? 'blocked' : 'planned',
      tools_requested: requestedTools,
      tools_executed: [],
      warning: requestedTools.length
        ? 'Tool execution is disabled: a verified isolated executor and runtime authorization adapter are not yet available.'
        : null,
    };
  }
}

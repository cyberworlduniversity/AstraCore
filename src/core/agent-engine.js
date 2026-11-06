import { verifyToolResult } from './safety-layer.js';

export const AGENT_ROLES = Object.freeze(['planner','researcher','coder','analyst','document','security','browser']);

export class AgentEngine {
  constructor({ toolRegistry, maxSteps = 8 } = {}) {
    this.toolRegistry = toolRegistry;
    this.maxSteps = Math.min(Math.max(Number(maxSteps) || 8, 1), 20);
  }

  plan(task, role = 'planner') {
    if (!AGENT_ROLES.includes(role)) throw Object.assign(new Error('Unknown agent role'), { status: 400 });
    return {
      role,
      steps: [
        { action: 'understand', task: String(task).slice(0, 4000) },
        { action: 'verify' },
        { action: 'respond' },
      ],
    };
  }

  async run({ task, role = 'planner', context = {}, toolCalls = [], tools = [] } = {}) {
    const plan = this.plan(task, role);
    if (!this.toolRegistry || typeof this.toolRegistry.execute !== 'function') {
      throw Object.assign(new Error('Policy-enforced tool registry is not configured'), { status: 501 });
    }
    const calls = Array.isArray(toolCalls) && toolCalls.length
      ? toolCalls
      : tools.slice(0, this.maxSteps).map((name) => ({ name, input: { task: String(task).slice(0, 4000) } }));
    if (!Array.isArray(calls) || calls.length > this.maxSteps) {
      throw Object.assign(new Error('Agent tool-call limit exceeded'), { status: 400 });
    }

    const results = [];
    for (const call of calls) {
      if (!call || typeof call.name !== 'string' || !call.name) {
        throw Object.assign(new Error('Each agent tool call requires a tool name'), { status: 400 });
      }
      const started = Date.now();
      try {
        const result = await this.toolRegistry.execute(call.name, call.input, {
          authenticated: context.authenticated === true,
          isAdmin: context.isAdmin === true,
          explicitApproval: context.explicitApproval === true,
          allowedTools: context.allowedTools,
          userId: context.userId,
          requestId: context.requestId,
          audit: context.audit,
        });
        const verification = verifyToolResult(result);
        results.push({
          tool: call.name,
          durationMs: Date.now() - started,
          verification,
          result: verification.valid ? result : null,
        });
        if (!verification.valid) break;
      } catch (error) {
        results.push({
          tool: call.name,
          durationMs: Date.now() - started,
          verification: { valid: false, reason: String(error.code || error.message || 'tool_failed').slice(0, 500) },
          result: null,
        });
        break;
      }
    }

    return {
      plan,
      results,
      status: results.every((item) => item.verification.valid) ? 'completed' : 'blocked',
    };
  }
}

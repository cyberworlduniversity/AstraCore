import { assertToolAuthorization, verifyToolResult, redactSecrets } from './safety-layer.js';

export const AGENT_ROLES = Object.freeze(['planner','researcher','coder','analyst','document','security','browser']);

export class AgentEngine {
  constructor({ toolRegistry, executeTool, maxSteps = 8 } = {}) {
    this.toolRegistry = toolRegistry;
    this.executeTool = executeTool;
    this.maxSteps = Math.min(Math.max(Number(maxSteps) || 8, 1), 20);
  }

  plan(task, role = 'planner') {
    if (!AGENT_ROLES.includes(role)) throw Object.assign(new Error('Unknown agent role'), { status: 400 });
    return { role, steps: [{ action: 'understand', task: String(task).slice(0, 4000) }, { action: 'verify' }, { action: 'respond' }] };
  }

  async run({ task, role = 'planner', context = {}, tools = [] } = {}) {
    const plan = this.plan(task, role);
    const results = [];
    for (const toolName of tools.slice(0, this.maxSteps)) {
      const tool = this.toolRegistry?.get(toolName);
      assertToolAuthorization(tool, context);
      if (typeof this.executeTool !== 'function') throw Object.assign(new Error('Tool executor is not configured'), { status: 501 });
      const started = Date.now();
      const result = await Promise.race([
        Promise.resolve(this.executeTool(tool, { task, context })),
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Tool timeout'), { status: 504 })), Math.min(tool.timeoutMs || 15000, 30000)))
      ]);
      const verification = verifyToolResult(result);
      results.push({ tool: toolName, durationMs: Date.now() - started, verification, result: verification.valid ? redactSecrets(JSON.stringify(result)).slice(0, 12000) : null });
      if (!verification.valid) break;
    }
    return { plan, results, status: results.every((item) => item.verification.valid) ? 'completed' : 'blocked' };
  }
}

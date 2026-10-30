import { authorizeTool, buildAgentPlan } from './step16-27.js';

export class ToolRegistry {
  constructor() { this.tools = new Map(); }
  register(tool) { if (!tool?.name) throw new Error('tool name required'); this.tools.set(tool.name, Object.freeze({...tool})); return tool.name; }
  list() { return [...this.tools.values()]; }
  get(name) { return this.tools.get(name) || null; }
  async execute(name, input, request = {}) {
    const tool = this.get(name); const auth = authorizeTool(tool, request);
    if (!auth.allowed) throw Object.assign(new Error(auth.reason), { code: 'TOOL_NOT_AUTHORIZED' });
    if (typeof tool.execute !== 'function') throw new Error('tool executor missing');
    const timeout = Math.min(Math.max(Number(tool.timeout_ms) || 10000, 100), 60000);
    return await Promise.race([tool.execute(input, request), new Promise((_, reject) => setTimeout(() => reject(new Error('tool timeout')), timeout))]);
  }
}

export function planAgentTasks(tasks) { return buildAgentPlan(tasks); }

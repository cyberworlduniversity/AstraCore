import { buildAgentPlan } from './step16-27.js';
import { executeToolWithPolicy } from './tool-execution-boundary.js';

export class ToolRegistry {
  constructor() { this.tools = new Map(); }

  register(tool) {
    if (!tool?.name || typeof tool.name !== 'string') throw new Error('tool name required');
    if (!tool.inputSchema || tool.inputSchema.type !== 'object') throw new Error('tool input schema must be a JSON object schema');
    if (tool.execute !== undefined && typeof tool.execute !== 'function') throw new Error('tool execute must be a function');
    this.tools.set(tool.name, Object.freeze({ ...tool }));
    return tool.name;
  }

  list() { return [...this.tools.values()].map(({ execute, ...metadata }) => metadata); }
  get(name) { return this.tools.get(name) || null; }

  async execute(name, input, request = {}) {
    const tool = this.get(name);
    if (!tool) throw Object.assign(new Error('Tool not found'), { status: 404 });
    return executeToolWithPolicy(tool, input, request);
  }
}

export function planAgentTasks(tasks) { return buildAgentPlan(tasks); }

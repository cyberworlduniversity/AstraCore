import { buildAgentPlan } from './step16-27.js';
import { executeToolWithPolicy } from './tool-execution-boundary.js';

function freezeSchema(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeSchema(child);
  return Object.freeze(value);
}

export class ToolRegistry {
  constructor({ auditWriter, authorizeContext } = {}) { this.tools = new Map(); this.auditWriter = auditWriter; this.authorizeContext = authorizeContext; }

  register(tool) {
    if (!tool?.name || typeof tool.name !== 'string') throw new Error('tool name required');
    if (!tool.inputSchema || tool.inputSchema.type !== 'object') throw new Error('tool input schema must be a JSON object schema');
    if (tool.execute !== undefined && typeof tool.execute !== 'function') throw new Error('tool execute must be a function');
    const definition = Object.freeze({ ...tool, inputSchema: freezeSchema(structuredClone(tool.inputSchema)) });
    this.tools.set(tool.name, definition);
    return tool.name;
  }

  list() { return [...this.tools.values()].map(({ execute, ...metadata }) => metadata); }
  get(name) { return this.tools.get(name) || null; }

  async execute(name, input, request = {}) {
    const tool = this.get(name);
    if (!tool) throw Object.assign(new Error('Tool not found'), { status: 404 });
    if (typeof this.authorizeContext !== 'function') throw Object.assign(new Error('Trusted server authorization resolver is not configured'), { status: 503, code: 'AUTH_RESOLVER_UNAVAILABLE' });
    const authorization = await this.authorizeContext(request);
    if (!authorization || authorization.authenticated !== true || !authorization.userId) throw Object.assign(new Error('Trusted authenticated principal is required'), { status: 401, code: 'TOOL_NOT_AUTHORIZED' });
    return executeToolWithPolicy(tool, input, { ...authorization, audit: this.auditWriter });
  }
}

export function planAgentTasks(tasks) { return buildAgentPlan(tasks); }

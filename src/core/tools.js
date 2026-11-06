import { executeToolWithPolicy } from './tool-execution-boundary.js';

export class ToolRegistry {
  constructor(definitions = []) {
    this.tools = new Map();
    for (const tool of definitions) this.register(tool);
  }

  register(tool) {
    if (!tool?.name || !tool?.description || !tool?.inputSchema) throw new Error('Invalid tool definition');
    this.tools.set(tool.name, Object.freeze({ ...tool }));
    return this.tools.get(tool.name);
  }

  get(name) { return this.tools.get(name) || null; }
  list() { return [...this.tools.values()].map(({ execute, ...metadata }) => metadata); }

  assertAllowed(name, { authenticated = false, allowedTools = [] } = {}) {
    const tool = this.get(name);
    if (!tool) throw Object.assign(new Error('Unknown tool'), { status: 404 });
    if (tool.status === 'not_implemented' || tool.status === 'disabled') {
      throw Object.assign(new Error(`${name} is NOT IMPLEMENTED`), { status: 501 });
    }
    if (!authenticated || (allowedTools.length && !allowedTools.includes(name))) {
      throw Object.assign(new Error(`Permission denied for tool: ${name}`), { status: 403 });
    }
    return tool;
  }

  async execute(name, input, request = {}) {
    const registered = this.assertAllowed(name, request);
    const tool = {
      ...registered,
      enabled: registered.status === 'enabled',
      risk: registered.risk || registered.riskLevel || 'low',
      timeoutMs: registered.timeoutMs || registered.timeout_ms,
    };
    return executeToolWithPolicy(tool, input, request);
  }
}

export function defaultToolDefinitions() {
  return [
    { name: 'file_search', description: 'Search user-owned indexed knowledge.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 1000 } }, required: ['query'], additionalProperties: false }, status: 'enabled', riskLevel: 'low' },
    { name: 'web_search', description: 'Search current public web information with citations.', inputSchema: { type: 'object' }, status: 'not_implemented', riskLevel: 'medium' },
    { name: 'calculator', description: 'Perform deterministic calculations.', inputSchema: { type: 'object' }, status: 'not_implemented', riskLevel: 'low' },
    { name: 'code_execution', description: 'Run Python in an isolated sandbox.', inputSchema: { type: 'object' }, status: 'not_implemented', riskLevel: 'high' },
    { name: 'database_query', description: 'Run approved read-only structured data queries.', inputSchema: { type: 'object' }, status: 'not_implemented', riskLevel: 'high' },
    { name: 'image_analysis', description: 'Analyze successfully processed images.', inputSchema: { type: 'object' }, status: 'not_implemented', riskLevel: 'medium' },
  ];
}

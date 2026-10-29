export class ToolRegistry {
  constructor(definitions = []) {
    this.tools = new Map(definitions.map((tool) => [tool.name, Object.freeze({ ...tool })]));
  }

  register(tool) {
    if (!tool?.name || !tool?.description || !tool?.inputSchema) throw new Error('Invalid tool definition');
    this.tools.set(tool.name, Object.freeze({ ...tool }));
    return this.tools.get(tool.name);
  }

  get(name) { return this.tools.get(name) || null; }
  list() { return [...this.tools.values()]; }

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
}

export function defaultToolDefinitions() {
  return [
    { name: 'file_search', description: 'Search user-owned indexed knowledge.', inputSchema: { type: 'object' }, status: 'enabled', riskLevel: 'low' },
    { name: 'web_search', description: 'Search current public web information with citations.', inputSchema: { type: 'object' }, status: 'not_implemented', riskLevel: 'medium' },
    { name: 'calculator', description: 'Perform deterministic calculations.', inputSchema: { type: 'object' }, status: 'not_implemented', riskLevel: 'low' },
    { name: 'code_execution', description: 'Run Python in an isolated sandbox.', inputSchema: { type: 'object' }, status: 'not_implemented', riskLevel: 'high' },
    { name: 'database_query', description: 'Run approved read-only structured data queries.', inputSchema: { type: 'object' }, status: 'not_implemented', riskLevel: 'high' },
    { name: 'image_analysis', description: 'Analyze successfully processed images.', inputSchema: { type: 'object' }, status: 'not_implemented', riskLevel: 'medium' },
  ];
}

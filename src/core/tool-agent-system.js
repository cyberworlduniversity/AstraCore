// Compatibility facade: there is one canonical registry in ./tools.js.
// Tool execution is intentionally not implemented in this registry.
export { ToolRegistry } from './tools.js';
import { buildAgentPlan } from './step16-27.js';

export function planAgentTasks(tasks = []) {
  return buildAgentPlan(Array.isArray(tasks) ? tasks.slice(0, 16) : []);
}

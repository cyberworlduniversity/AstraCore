import { buildPlan } from './router.js';
import { sourceList } from './source.js';
import {
  buildBoundedContext,
  createRequestContext,
  finalizeResponse,
  rankAndDedupeSources,
  safetyBoundary,
  selectMemories,
} from './production-pipeline.js';
import { buildRagContext } from './steps18-20-runtime.js';

export class AstraCoreOrchestrator {
  constructor({ modelProvider, knowledgeRouter, memoryLoader = null, toolRegistry = null, toolExecutors = {} }) {
    this.modelProvider = modelProvider;
    this.knowledgeRouter = knowledgeRouter;
    this.memoryLoader = memoryLoader;
    this.toolRegistry = toolRegistry;
    this.toolExecutors = toolExecutors;
  }

  async prepare(query, options = {}) {
    const context = createRequestContext(query, options);
    const plan = buildPlan(query, options);
    context.plan = plan;

    if (plan.intent === 'file_search' && this.knowledgeRouter) {
      const rows = await this.knowledgeRouter.search(query, { limit: options.limit || 8 });
      context.knowledge = rankAndDedupeSources(rows, options.limit || 8);
      context.sources = sourceList(context.knowledge);
      context.tools_used.push('file_search');
    } else if (plan.intent === 'memory' && this.memoryLoader) {
      const memories = await this.memoryLoader(query, { limit: options.limit || 8 });
      context.memories = selectMemories(memories, options.limit || 8);
      context.tools_used.push('memory');
    }

    if (this.toolRegistry && plan.steps?.length) context.tool_plan = plan.steps;

    if (plan.intent === 'web_search') {
      context.tools_used.push('web_search');
      context.warnings.push('WebSearchTool is NOT IMPLEMENTED in this release.');
    } else if (plan.intent === 'calculator') {
      context.tools_used.push('calculator');
      context.warnings.push('Calculator tool is NOT IMPLEMENTED in this release.');
    } else if (plan.intent === 'code_execution') {
      context.tools_used.push('code_execution');
      context.warnings.push('Sandboxed Python execution is NOT IMPLEMENTED in this release.');
    } else if (plan.intent === 'data_analysis') {
      context.tools_used.push('database_query');
      context.warnings.push('Structured data analysis tool is NOT IMPLEMENTED in this release.');
    }

    context.rag = buildRagContext({ query, knowledge: context.knowledge, memories: context.memories, extra: context.warnings.join('\n') });
    context.knowledge = context.rag.knowledge;
    context.memories = context.rag.memories;
    return context;
  }

  buildPrompt(query, context) {
    return [
      safetyBoundary(),
      context.rag?.context || buildBoundedContext({ query, knowledge: context.knowledge, memories: context.memories, extra: context.warnings.join('\n') }),
      'Answer honestly. If evidence is insufficient, state that it could not be verified.',
    ].join('\n\n');
  }

  async run(query, options = {}) {
    const context = await this.prepare(query, options);
    const model = this.modelProvider.getModelInfo();
    context.model = model;

    if (context.warnings.length && !context.knowledge.length && !context.memories.length && context.plan.intent !== 'model') {
      return finalizeResponse({ answer: context.warnings[0], context, model });
    }

    const generated = await this.modelProvider.generate(this.buildPrompt(query, context), options.generation || {});
    const answer = typeof generated === 'string' ? generated : generated?.text || '';
    return finalizeResponse({ answer, context, model });
  }
}

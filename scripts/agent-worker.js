import { randomUUID } from 'node:crypto';
import { createAstraCoreLMClient } from '../src/ai/astracore-lm-client.js';
import { createAgentWorker } from '../src/agent/worker.js';
import { runAgentTask } from '../src/agent/orchestrator.js';
import { evaluateAgentRun } from '../src/agent/evaluation.js';
import { createSupabaseAgentWorkerAdapters } from '../src/agent/supabase-worker-adapters.js';

const supabaseUrl = process.env.ASTRACORE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceRoleKey = process.env.ASTRACORE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const workerId = process.env.ASTRA_WORKER_ID || 'astracore-worker-' + randomUUID();

const modelClient = createAstraCoreLMClient({
  url: process.env.ASTRACORE_LM_URL || '',
  token: process.env.ASTRACORE_LM_TOKEN || '',
  expectedCheckpointSha256: process.env.ASTRACORE_LM_APPROVED_CHECKPOINT_SHA256 || '',
});

const modelStatus = await modelClient.refresh();
if (!modelStatus.ready) {
  throw new Error('AstraCore private worker will not start without an approved, hash-verified AstraCoreLM runtime.');
}

const adapters = createSupabaseAgentWorkerAdapters({ supabaseUrl, serviceRoleKey });
const worker = createAgentWorker({
  workerId,
  ...adapters,
  executeTask: async ({ task, agentType, job, onProgress, isCancelled }) => {
    const execution = await runAgentTask({
      task,
      agentType,
      modelClient,
      knowledgeSearch: (query) => adapters.knowledgeSearch({ userId: job.user_id, query }),
      onProgress,
      isCancelled,
    });
    const evaluation = evaluateAgentRun({
      task,
      answer: execution.answer,
      toolResults: execution.tool_results,
      metrics: execution.metrics || {},
    });
    return { ...execution, evaluation };
  },
});

let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
while (!stopping) {
  try {
    const result = await worker.runOnce({ limit: 1 });
    if (result.claimed === 0) await sleep(1500);
  } catch {
    // Do not log credentials, request bodies, user prompts, or provider responses.
    process.stderr.write('AstraCore worker tick failed; retrying after a short delay.\n');
    await sleep(5000);
  }
}

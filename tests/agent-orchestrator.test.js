import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSafeExpression, runAgentTask } from '../src/agent/orchestrator.js';

test('calculator evaluates bounded arithmetic without eval or code execution', () => {
  assert.equal(calculateSafeExpression('2 + 3 * (4 - 1)'), 11);
  assert.equal(calculateSafeExpression('-2^2'), -4);
  assert.equal(calculateSafeExpression('2^3^2'), 512);
  assert.throws(() => calculateSafeExpression('1/0'), /zero/);
  assert.throws(() => calculateSafeExpression('process.exit()'), /unsupported/);
  assert.throws(() => calculateSafeExpression('1;globalThis.x=1'), /unsupported/);
  assert.throws(() => calculateSafeExpression('9^999'), /range|finite/i);
});

test('agent plans with the model and executes only allowlisted read-only tools', async () => {
  const calls = [];
  const modelClient = {
    generate: async (prompt) => {
      calls.push(prompt);
      if (calls.length === 1) {
        return { text: JSON.stringify({
          steps: ['Search my notes', 'Calculate the requested total'],
          tool_calls: [
            { name: 'knowledge_search', input: { query: 'network security notes' } },
            { name: 'calculator', input: { expression: '12*8' } },
            { name: 'code_execution', input: { code: 'throw new Error("no")' } },
          ],
        }) };
      }
      return { text: 'Your notes mention network security. The calculation is 96.' };
    },
  };
  let searchQuery = '';
  const result = await runAgentTask({
    task: 'Find my network security notes and calculate 12 times 8',
    agentType: 'research',
    modelClient,
    knowledgeSearch: async (query) => { searchQuery = query; return [{ title: 'Network notes', content: 'Firewall and segmentation.' }]; },
  });
  assert.equal(calls.length, 3);
  assert.equal(searchQuery, 'network security notes');
  assert.equal(result.status, 'completed');
  assert.equal(result.execution_policy, 'allowlisted_read_only');
  assert.deepEqual(result.tools_executed.sort(), ['calculator', 'knowledge_search']);
  assert.equal(result.tool_results[1].output.value, 96);
  assert.equal(result.tools_requested.includes('code_execution'), false);
  assert.match(result.answer, /96/);
});

test('agent refuses execution without an approved model runtime', async () => {
  await assert.rejects(runAgentTask({ task: 'Do a task' }), /approved AstraCoreLM runtime/);
});

test('agent falls back to a no-tool plan when model planner output is malformed', async () => {
  let calls = 0;
  const result = await runAgentTask({
    task: 'Explain a simple concept',
    modelClient: { generate: async () => ({ text: ++calls === 1 ? 'not json' : 'A simple explanation.' }) },
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.tools_executed, []);
  assert.equal(result.answer, 'A simple explanation.');
});


test('agent enforces one total tool-call budget across planning and review', async () => {
  let calls = 0;
  let searches = 0;
  const result = await runAgentTask({
    task: 'Search and calculate',
    modelClient: { generate: async (prompt) => {
      calls += 1;
      if (calls === 1) return { text: JSON.stringify({ steps: ['Search'], tool_calls: [
        { name: 'calculator', input: { expression: '1+1' } },
        { name: 'calculator', input: { expression: '2+2' } },
        { name: 'calculator', input: { expression: '3+3' } },
      ] }) };
      if (calls === 2) return { text: JSON.stringify({ complete: false, tool_calls: [
        { name: 'calculator', input: { expression: '4+4' } },
      ] }) };
      return { text: 'Completed within the tool budget.' };
    } },
    knowledgeSearch: async () => { searches += 1; return []; },
  });
  assert.equal(calls, 3);
  assert.equal(result.metrics.tool_calls_requested, 3);
  assert.equal(result.tool_results.length, 3);
  assert.equal(searches, 0);
});

test('knowledge-search adapter failures are recorded without crashing the agent', async () => {
  let calls = 0;
  const result = await runAgentTask({
    task: 'Find my notes',
    modelClient: { generate: async () => {
      calls += 1;
      if (calls === 1) return { text: JSON.stringify({ steps: ['Search notes'], tool_calls: [
        { name: 'knowledge_search', input: { query: 'my notes' } },
      ] }) };
      if (calls === 2) return { text: JSON.stringify({ complete: true, reflection: 'Search failed; report the limitation.' }) };
      return { text: 'I could not retrieve the notes because the knowledge search failed.' };
    } },
    knowledgeSearch: async () => { throw new Error('temporary search outage'); },
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.metrics.tool_calls_failed, 1);
  assert.match(result.tool_results[0].error, /temporary search outage/);
  assert.equal(result.metrics.duration_ms >= 0, true);
});


test('agent reports durable progress phases to the persistence adapter', async () => {
  const phases = [];
  let calls = 0;
  const result = await runAgentTask({
    task: 'Explain a concept',
    modelClient: { generate: async () => ({ text: ++calls === 1 ? JSON.stringify({ steps: ['Understand'] }) : calls === 2 ? JSON.stringify({ complete: true, reflection: 'Enough context.' }) : 'A clear explanation.' }) },
    onProgress: async (event) => { phases.push(event.phase); },
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(phases, ['planning', 'executing_tools', 'reviewing', 'generating_answer', 'completed']);
});

test('agent cancellation is checked between model and tool phases', async () => {
  let checks = 0;
  let modelCalls = 0;
  await assert.rejects(
    runAgentTask({
      task: 'Stop this run',
      modelClient: { generate: async () => ({ text: ++modelCalls === 1 ? JSON.stringify({ steps: ['Start'] }) : 'Should not be called' }) },
      isCancelled: async () => ++checks >= 2,
    }),
    (error) => error.code === 'AGENT_RUN_CANCELLED' && error.status === 409,
  );
  assert.equal(modelCalls, 1);
});

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

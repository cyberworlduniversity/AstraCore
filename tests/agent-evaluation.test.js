import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAgentRun } from '../src/agent/evaluation.js';

test('evaluation reports successful bounded execution without overstating factual correctness', () => {
  const result = evaluateAgentRun({
    task: 'Calculate 12 times 8',
    answer: '96',
    toolResults: [{ tool: 'calculator', output: { value: 96 } }],
    metrics: { tool_calls_requested: 1, tool_calls_succeeded: 1, tool_calls_failed: 0, duration_ms: 15 },
  });
  assert.equal(result.status, 'passed_basic_checks');
  assert.equal(result.tool_success_rate, 1);
  assert.match(result.note, /not factual correctness/i);
});

test('evaluation flags tool failures and empty responses for review', () => {
  const result = evaluateAgentRun({
    task: 'Research',
    answer: '',
    metrics: { tool_calls_requested: 2, tool_calls_succeeded: 1, tool_calls_failed: 1 },
  });
  assert.equal(result.status, 'needs_review');
  assert.ok(result.warnings.includes('empty_answer'));
  assert.ok(result.warnings.includes('one_or_more_tool_calls_failed'));
  assert.equal(result.tool_success_rate, 0.5);
});

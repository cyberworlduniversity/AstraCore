export function evaluateAgentRun({ answer, task, toolResults = [], metrics = {} } = {}) {
  const text = String(answer || '').trim();
  const requested = Number(metrics.tool_calls_requested || 0);
  const succeeded = Number(metrics.tool_calls_succeeded || 0);
  const failed = Number(metrics.tool_calls_failed || 0);
  const resultCount = toolResults.length;
  const toolSuccessRate = requested === 0 ? 1 : succeeded / requested;
  const hasAnswer = text.length > 0;
  const hasTask = String(task || '').trim().length > 0;
  const warnings = [];
  if (!hasAnswer) warnings.push('empty_answer');
  if (!hasTask) warnings.push('missing_task');
  if (failed > 0) warnings.push('one_or_more_tool_calls_failed');
  if (requested > 0 && resultCount === 0) warnings.push('no_tool_results_recorded');
  return {
    version: 'astracore-agent-eval-v1',
    answer_present: hasAnswer,
    task_present: hasTask,
    tool_success_rate: Number(toolSuccessRate.toFixed(4)),
    tool_calls_requested: requested,
    tool_calls_succeeded: succeeded,
    tool_calls_failed: failed,
    tool_results_count: resultCount,
    duration_ms: Math.max(0, Number(metrics.duration_ms || 0)),
    warnings,
    status: hasAnswer && hasTask && failed === 0 ? 'passed_basic_checks' : 'needs_review',
    note: 'These deterministic checks measure execution integrity, not factual correctness or semantic task completion. Human or separately validated evaluation is still required for those claims.',
  };
}

export const EVALUATION_METRICS = Object.freeze(['accuracy','retrieval_recall','groundedness','hallucination_rate','tool_success_rate','latency_ms','memory_accuracy','multilingual_accuracy','cybersecurity_benchmark']);

export function evaluateGates(metrics = {}, gates = {}) {
  const checks = Object.entries(gates).map(([metric, threshold]) => {
    const value = Number(metrics[metric]);
    const lowerIsBetter = /hallucination|latency/.test(metric);
    const passed = Number.isFinite(value) && (lowerIsBetter ? value <= Number(threshold) : value >= Number(threshold));
    return { metric, value, threshold: Number(threshold), passed };
  });
  return { passed: checks.length > 0 && checks.every((check) => check.passed), checks };
}

export function productionPromotion(metrics, gates) {
  const result = evaluateGates(metrics, gates);
  return { status: result.passed ? 'approved' : 'blocked', ...result, promotedAt: result.passed ? new Date().toISOString() : null };
}

# AstraCore architecture derived from Mastering AI Agents

This implementation translates the book's agent patterns into AstraCore's existing runtime without introducing a third-party agent framework or external model API.

## Runtime pattern

AstraCore combines:
- **ReAct:** a bounded planner → approved tool execution → review/replan → final response cycle.
- **RAG:** authenticated, user-scoped knowledge retrieval; retrieved content is treated as untrusted evidence, never as instructions.
- **Tool-enhanced execution:** strict built-in allowlist with parameter bounds and output validation.
- **Self-reflection:** a review pass checks whether more approved evidence is needed before the final answer.
- **Human oversight:** high-risk tools remain unavailable until a separately reviewed isolated executor and approval workflow exist.
- **Evaluation:** deterministic execution-integrity metrics are recorded with each run. They do not pretend to prove factual correctness; semantic evaluation and human review remain separate.

## Execution limits

- One planner pass and at most one bounded replan pass in this iteration.
- Three model calls maximum: plan, review, final answer.
- At most three tool calls in each plan response.
- Calculator and authenticated knowledge search only.
- No shell, arbitrary code, public network fetch, file writes, database mutations, or external side effects.
- A failed or unavailable model runtime remains a hard failure; no fallback model is silently substituted.

## Evaluation data

Each run records tool-call counts, success/failure counts, planning cycles, and a basic execution-quality status. These measurements cover runtime integrity, not truthfulness, context adherence, or task completion quality. Those require a separate benchmark with labelled test cases and human-reviewed ground truth.

## Further work before production

1. Complete multi-cycle state persistence and resumable execution.
2. Add isolated execution infrastructure for carefully approved high-risk tools.
3. Add source-level citation and evidence coverage scoring to RAG responses.
4. Build a labelled benchmark for task completion, context adherence, tool selection, latency, and cost.
5. Add human approval, cancellation, retry/backoff, and durable audit events.
6. Complete adversarial tests for untrusted retrieved content and tool parameters.

The reference book is used as architectural guidance, not copied code. The existing AstraCoreLM v0.2 approval gate remains mandatory.

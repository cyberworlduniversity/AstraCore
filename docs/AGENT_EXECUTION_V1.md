# AstraCore Agent Execution v1

## Execution contract

Authenticated users can request a real model-backed agent run:

```http
POST /api/agents
Content-Type: application/json

{
  "task": "Search my network security notes and calculate 12 times 8",
  "agent_type": "research",
  "execute": true
}
```

The endpoint requires an authenticated session and a remote AstraCoreLM v0.2 runtime that passes the independent production approval and checkpoint SHA-256 verification gate. The runtime credentials remain server-side.

## Current execution loop

1. Validate and bound the user task.
2. Ask the approved AstraCoreLM runtime for a constrained JSON plan.
3. Validate the proposed tool calls against a hard-coded allowlist.
4. Execute at most three safe built-in tool calls.
5. Persist bounded progress snapshots and heartbeat timestamps to `astracore_agent_runs`.
6. Check for a user cancellation request between model/tool phases and stop at the next safe checkpoint.
7. Pass bounded, untrusted tool results back to the model.
8. Generate a bounded final answer and persist the terminal result.

## Available tools

- `calculator`: deterministic arithmetic parser; no eval, shell, or dynamic code.
- `knowledge_search`: authenticated, user-scoped AstraCore knowledge retrieval.

Unknown tools are discarded. The planner cannot enable a tool by naming it in generated JSON.

## Disabled capabilities

Shell commands, arbitrary code execution, file writes, database mutations, public web fetching, account actions, and other high-risk tools remain disabled. They require a separately deployed isolated executor, tool-specific authorization, audit logging, cancellation, and explicit approval where appropriate. Do not treat the current allowlisted executor as a general-purpose OS sandbox.

## Required production runtime configuration

Configure these only as server-side environment variables in the relevant runtime:

- `ASTRACORE_LM_URL`: HTTPS origin of the separately hosted Python inference service.
- `ASTRACORE_LM_TOKEN`: long random bearer token (at least 32 characters).
- `ASTRACORE_LM_APPROVED_CHECKPOINT_SHA256`: exact approved checkpoint SHA-256.

The remote service must independently report `production_approved: true` and the exact configured checkpoint hash. Without this, agent execution returns HTTP 503 and does not claim that a run completed.

## Vercel note

The Vercel serverless API and the standalone Node server are separate entry points. Both now use the same approved remote AstraCoreLM client contract. Vercel cannot host the PyTorch model process as part of this Node serverless handler; the Python model service needs dedicated compute and a private HTTPS endpoint.


## Durable run inspection and cancellation

- `GET /api/agents/:runId` returns a run only when it belongs to the authenticated user.
- `POST /api/agents/:runId/cancel` records a cancellation request only for an unfinished run owned by the authenticated user.
- `execution_state` stores a small phase/progress snapshot; `heartbeat_at`, `started_at`, and `finished_at` support operational inspection.
- Cancellation is cooperative: the running worker checks the durable request between model/tool phases. It cannot interrupt a model provider call already in progress; it stops at the next checkpoint.
- The additive migration `20261105090000_add_durable_agent_run_state.sql` adds the state and cancellation columns. Apply it through the project's reviewed Supabase migration process before deploying this API revision.
- A worker crash can leave a run without `finished_at`; production operations still need a stale-run reconciler/lease policy before treating every active record as live.

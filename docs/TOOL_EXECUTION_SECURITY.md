# AstraCore Tool Execution Security Boundary

## What this milestone provides

The tool registry now routes calls through one policy-enforced execution boundary. Before an adapter is called, the boundary:

- Requires a trusted server-side authorization resolver, authenticated principal, per-user tool allow-list, and constructor-injected audit writer. Request-supplied authentication flags and audit callbacks are not trusted.
- Requires the tool to be explicitly enabled and present in the resolved principal's allow-list.
- Requires explicit approval for high-risk tools.
- Validates JSON-object inputs against the registered schema, including required fields, primitive types, bounds, and undeclared-property rejection by default.
- Applies a 64 KiB input limit, a per-tool deadline capped at 30 seconds, and a 64 KiB JSON output limit.
- Sends an AbortSignal to the adapter on timeout.
- Redacts common secret patterns in returned text and writes metadata-only start/completion/failure audit events.

The agent engine delegates execution to the registry rather than invoking a separate executor callback, preventing that path from bypassing registry policy.

## Important isolation boundary

This is an **application-level policy boundary**, not an operating-system or container sandbox. JavaScript adapters execute in the AstraCore server process. An AbortSignal cannot forcibly stop a synchronous CPU loop or undo an already-performed side effect. The boundary does not make arbitrary code safe.

Therefore:

- Do not register user-supplied code, shell commands, eval, dynamic imports, or arbitrary scripts as tool adapters.
- `code_execution`, `database_query`, web search, and other unimplemented tools must remain disabled.
- No tool adapter should receive server environment variables, raw credentials, filesystem access, or unrestricted network access.
- Audit writing must be implemented by a trusted server-side audit sink before any adapter is enabled for real users.
- Any future code execution tool requires a separate worker/container or VM with a read-only base image, dedicated unprivileged identity, no host mounts, network disabled by default, strict CPU/memory/process/time quotas, syscall restrictions, ephemeral storage, and teardown after every job.
- A future database tool must use a separate least-privilege read-only database identity and fixed query templates; never accept raw SQL from model output.

## Current status

The registry and agent orchestration path are protected by unit tests, but tests must still run in CI. No trusted server authorization resolver or durable audit writer is wired into the production HTTP server yet, so the runtime fails closed and cannot execute tools. Existing tool catalog entries are not proof that their adapters exist. The code-execution catalog entry remains marked `not_implemented`. No production tool execution is enabled by this change.

The tool execution boundary does not change the AstraCoreLM production gate. `production_approved` remains false until independent model and system validation plus explicit human approval.

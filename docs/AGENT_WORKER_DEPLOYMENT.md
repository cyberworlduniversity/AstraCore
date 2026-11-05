# AstraCore private worker deployment

## Purpose

This is a separate long-running Node.js worker, not a Vercel serverless route. It polls the durable queue, claims one job at a time, renews its lease, executes only through the approved AstraCoreLM client and bounded agent orchestrator, and persists the result through lease-guarded RPCs.

## Required server-only environment

- \`ASTRACORE_SUPABASE_URL\` or \`SUPABASE_URL\`
- \`ASTRACORE_SUPABASE_SERVICE_ROLE_KEY\` or \`SUPABASE_SERVICE_ROLE_KEY\`
- \`ASTRACORE_LM_URL\`
- \`ASTRACORE_LM_TOKEN\`
- \`ASTRACORE_LM_APPROVED_CHECKPOINT_SHA256\`
- Optional \`ASTRA_WORKER_ID\`

Never place the service-role key or model bearer token in browser/mobile variables, public build arguments, logs, or client bundles.

## Startup gates

The worker refuses to start unless the remote AstraCoreLM health endpoint reports the exact v0.2 model version, production approval, and the configured checkpoint SHA-256. It also requires HTTPS for remote Supabase connections and a server-side service-role key.

## Queue behavior

- Claims at most one job per tick.
- Renews the lease during execution.
- Checks cancellation between model/tool phases.
- Reads run rows by both run ID and user ID.
- Searches knowledge through a dedicated service-role RPC with an explicit user ID filter; it does not call the authenticated-only \`auth.uid()\` search RPC.
- Persists progress and completion only through lease-token guarded RPCs.
- Uses retry/dead-letter handling for failures and does not retry after an uncertain completion response.

## Deployment status

The worker entrypoint and container recipe are committed as a development foundation. They are not deployed or running. The required queue migrations have not been applied to the connected Supabase project, and the service-role/model secrets have not been configured or verified for a worker host. Do not start the worker until those prerequisites and disposable-Postgres integration tests pass.

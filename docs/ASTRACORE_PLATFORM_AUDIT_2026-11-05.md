# AstraCore Platform Audit — 2026-11-05

Read-only review of GitHub, Vercel and Supabase. No production deployment or database change was made.

## Findings

- GitHub main contains a Node.js 24 ESM server, local neural model/tokenizer/inference/checkpoint code, auth, chat, memory, knowledge ingestion and retrieval, model/evaluation APIs, and initial agent/tool routes.
- The server requires a checkpoint explicitly marked production_ready before neural chat serving. AstraCoreLM v0.2 remains behind a closed production gate.
- Supabase is ACTIVE_HEALTHY in eu-west-1 on PostgreSQL 17.11.0.003. There are 29 migrations, 21 public application tables, RLS enabled on all 21 returned tables, and pgvector 0.8.2 installed. No Edge Functions were listed.
- Supabase security advisor: leaked-password protection is disabled.
- Supabase performance advisor: 7 auth/RLS init-plan warnings and 46 multiple-permissive-policy warnings; unused-index warnings also appeared. These require policy/query review, not blind deletion.
- Vercel projects astracore-ai and astracore-ai-v01 both have READY preview deployments. astracore-ai-v01 also has a READY production deployment on main. A READY web deployment does not prove the Python model runtime or all API paths work end-to-end.
- Vercel environment metadata was inspected without decrypting or exposing secrets.

## Confirmed code issue

POST /api/agents currently writes task and metadata fields, but the live public.astracore_agent_runs table exposes agent_type, plan and result. This API/database contract mismatch is likely to break agent-run creation. The separate development branch is intended to correct this and keep execution plan-only.

## Priority gaps

1. Agent plan validation and database contract tests.
2. Tool registry schema validation, explicit approvals, and fail-closed authorization.
3. Sandboxed tool execution with CPU, memory, wall-clock, network and filesystem limits; do not enable arbitrary execution before this exists.
4. SSRF-safe web research and prompt-injection isolation.
5. RAG end-to-end and tenant-isolation tests; memory consent/revocation/expiry tests.
6. Multimodal, coding and data-analysis pipelines remain experimental/planned until end-to-end tests prove otherwise.
7. Enable leaked-password protection and review RLS advisor findings.
8. Verify Supabase Storage object policies and model checkpoint/runtime compatibility on Vercel.

No production branch, deployment, or Supabase schema/data was modified.

## Additional verification notes

- Both Vercel projects generated READY preview deployments for this branch. These confirm web build completion, not a test-suite pass or live model inference.
- Environment metadata was inspected without decrypting secrets. The astracore-ai variables returned by the connector are production-scoped; no preview-scoped entries were returned. The astracore-ai-v01 project returned no environment-variable entries. Verify preview backend/auth connectivity before relying on these previews.
- Existing GitHub Actions workflows target main pushes and pull requests into main, not feature-branch pushes. They configure Node 20 although package.json requires Node 24. One workflow also grants contents: write and has an automatic commit/push step on main; review that automation before depending on it for releases.
- Tests for the agent plan and fail-closed tool policy were added on this branch, but no GitHub Actions test run has yet confirmed them.

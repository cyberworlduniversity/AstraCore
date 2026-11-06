# AstraCore admin API authorization audit

Date: 2026-11-06

## Scope

Source-level review of the API router and route modules on the encrypted-session security branch:

- `server/server.js`
- `server/admin-routes.js`
- `server/system-routes.js`
- `server/production-routes.js`
- `server/knowledge-api.js`
- `server/cloud-api.js`
- `server/auth.js`

This is not a live penetration test and does not certify the deployed Supabase Row Level Security (RLS) policies.

## Authorization map

| Route family | Required identity | Enforcement point |
|---|---|---|
| `/api/admin/control`, `/api/admin/audit`, `/api/admin/catalog` | Administrator | Router calls `requireAdmin` before `adminRoute` |
| `/api/admin/models`, `/api/admin/users`, `/api/admin/overview` | Administrator | Each route calls `requireAdmin` |
| `/api/knowledge/**` | Authenticated user | Router calls `requireUser` before `knowledgeRoute` |
| `/api/memory/**`, `/api/tools`, `/api/models`, `/api/evaluation`, `/api/agents/**` | Authenticated user | Router calls `requireUser` before `handleProductionRoute` |
| `/api/projects/**`, `/api/files/**` | Authenticated user | Router calls `requireUser` before `cloudRoute` |
| Conversations and `/api/chat` | Authenticated user | Router calls `requireUser`; conversation reads/writes also include the current user ID |

## Finding and remediation

**Medium — unnecessary internal metadata was returned to every authenticated user.**

The regular-user `GET /api/tools` response selected tool input/output schemas, permission declarations, risk levels, timeout configuration, and authentication requirements. The regular-user `GET /api/models` response included checkpoint paths, training metadata, training seed, and device details. These fields are not needed for basic user-facing model/tool discovery.

Changes in this branch:

- `GET /api/tools` now selects only `name`, `description`, and `status`.
- `GET /api/models` retains user-facing architecture and model-size information but omits checkpoint paths, training metadata, device, and seed.
- `/api/system/status` no longer returns tool permission declarations to ordinary users.
- Regression tests assert the reduced database projections.
- Route-guard regression tests assert that admin route groups are protected before dispatch and user data route groups require authentication.

## Admin route review

- Admin control mutations are behind the router's administrator guard.
- The admin resource allowlist restricts editable columns and blocks deletion for protected resources.
- Admin audit writes are best-effort; a failed audit insert does not block the admin action. This should be revisited if policy requires guaranteed audit durability.
- Admin control reads and mutations rely on Supabase RLS for the effective database boundary. Live verification of the admin and non-admin JWT policies remains required.

## Validation still required

- Run the complete Node and Python CI suites on this branch.
- Verify non-admin requests receive 403 on every admin endpoint using a live authenticated deployment.
- Verify user A cannot read or mutate user B's records through the deployed Supabase RLS policies.
- Verify admin control list/update/delete behavior with a real admin session.
- Re-run browser and mobile login-to-chat regression tests after the security changes.

No production secrets, Supabase policies, user records, or deployment settings were changed.

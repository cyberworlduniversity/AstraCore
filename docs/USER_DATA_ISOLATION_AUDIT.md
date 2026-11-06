# AstraCore user data isolation audit

Date: 2026-11-06

## Scope and evidence

Reviewed the API routing and data-access modules on the user-isolation branch, and inspected the connected Supabase project metadata and PostgreSQL policy catalog.

- `server/server.js`
- `server/knowledge-api.js`
- `server/cloud-api.js`
- `server/production-routes.js`
- `server/auth.js`
- `src/core/knowledge.js`
- `src/core/knowledge-ingest.js`
- PostgreSQL `pg_tables`, `pg_policies`, and function definitions (read-only inspection)
- Supabase Security Advisor

No production database writes, policy changes, secret changes, or deployments were made.

## Findings

### Positive controls verified

- Every inspected table in the public schema has RLS enabled.
- Conversations have authenticated-owner SELECT/INSERT/UPDATE/DELETE policies using `auth.uid() = user_id`.
- Messages have owner-scoped policies; INSERT also verifies that the referenced conversation belongs to the same authenticated user.
- Memory, knowledge documents, knowledge chunks, and knowledge sources have owner-scoped policies.
- Cloud file metadata uses owner-scoped policies.
- Storage bucket `astracore-files` has SELECT/INSERT/UPDATE/DELETE policies constrained to the authenticated user's UUID folder.
- Knowledge search RPC is SECURITY INVOKER (not SECURITY DEFINER) and explicitly filters chunks by `auth.uid()`.
- The application sends the caller's Supabase access token on database requests, so Postgres RLS is evaluated as the authenticated caller rather than a service-role bypass.

### Application-layer defense-in-depth fixes

Some list and delete operations relied on RLS without also including an explicit owner filter in the REST query. RLS remains the database security boundary; the new filters reduce accidental exposure if a policy is later changed.

- Conversation list now filters by the authenticated user's `user_id`.
- Conversation lookup for chat reuse and conversation deletion now include the authenticated user's `user_id` in the same query.
- Knowledge document listing now filters by the authenticated user's `user_id`.
- Knowledge document deletion first selects the document by both document ID and owner.
- Knowledge chunk, document, and source deletes now include the same authenticated owner filter.

Regression tests cover the query scoping and knowledge delete sequence.

## Remaining findings / limitations

1. **Supabase Auth warning:** Security Advisor reports leaked-password protection is disabled. Enable it in Supabase Auth password security settings and test signup/password changes before public launch.
2. **Live two-account proof is pending:** A controlled test with two real non-admin accounts is still required to prove User A cannot read, update, or delete User B's records through the deployed API and direct Data API.
3. **Storage proof is pending:** Test signed download, list, upload, and delete using two real accounts and verify cross-user object paths are denied.
4. **Admin helper review:** `astracore_is_admin()` is SECURITY DEFINER with a fixed `search_path` and checks the caller's JWT email against the configured admin email. It does not read user-editable metadata. Keep its execute grants and function body under review; do not add arbitrary SQL or dynamic identifiers to it.
5. **Evaluation endpoint:** The evaluation table's current RLS policies are admin-only; the user-facing evaluation route may therefore return no rows for ordinary users. Confirm whether the endpoint should be admin-only or whether evaluations should be tenant-owned before changing this behavior.
6. **Production readiness:** This source and catalog audit is not a penetration test and does not replace CI, live two-account tests, deployment verification, or end-to-end login-to-chat tests.

## Supabase Security Advisor

The current security advisor returned one warning: leaked password protection disabled. No other security findings were returned in this scan. Re-run the advisor after changing Auth settings or database policies.

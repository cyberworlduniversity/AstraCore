# AstraCore memory consent and erasure review

Date: 2026-11-06

## Finding

The memory API already required explicit consent for writes and updates, scoped reads and writes by authenticated `user_id`, and excluded revoked or expired records from active-memory listing. Consent revocation marks the user's active records as revoked.

A privacy gap existed in permanent deletion: the DELETE route used the active-memory filter for its ownership lookup. That meant a user could no longer permanently erase a memory after revoking consent or after the memory expired, even though the user still owned the row.

## Fix

The DELETE route now looks up a memory by both `memory_id` and authenticated `user_id`, without filtering by consent status or expiry. It then deletes only that same user's record. It does not allow access to another user's memory.

A regression test covers erasure of a revoked memory and verifies both lookup and deletion include the authenticated owner filter.

## Validation and limits

- Regression test added to `tests/production-routes.test.js`.
- Full CI result must be checked on the PR before merge.
- Real two-account tests remain necessary for live proof.
- No production data, Supabase policy, Auth setting, secret, or deployment was changed.

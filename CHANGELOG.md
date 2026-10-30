# Changelog

## 2026-10-30 — v1.0 production completion run

- Re-audited the existing AstraCore architecture without replacing it.
- Verified the deterministic 1,236-record CC0 dataset and existing LM/embedding evidence.
- Tightened Supabase service-only RLS policies to `service_role`.
- Tightened embedding-evaluation policies to authenticated owner-scoped access.
- Optimized multiple RLS policies to use init-plan-safe auth evaluation; advisor warnings reduced from 16 to 7.
- Confirmed leaked-password protection remains externally blocked.
- Confirmed current Vercel production deployment is externally blocked by the free deployment quota.
- Added machine-readable and Markdown certification/evaluation/security/deployment/rollback evidence.
- Added a one-time hardening workflow intended to remove the Vercel API bootstrap model fallback and require a validated production-ready checkpoint.

Final status remains **PRODUCTION BLOCKED** because release-critical evidence and external controls are not complete.

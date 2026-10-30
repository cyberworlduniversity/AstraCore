# AstraCore v1.0 Security Audit

Status: **BLOCKED — release-critical evidence incomplete**.

## Verified
- Supabase RLS is enabled on all inspected `astracore_*` public tables.
- Owner-scoped memory, document, conversation and message policies exist.
- Service-only policies for capabilities/release sync were tightened to `service_role`.
- Embedding evaluation policies were tightened from `public` to `authenticated` and owner-scoped.
- Remaining RLS init-plan warnings were reduced from 16 to 7 after optimization.
- Leaked-password protection remains disabled and is an external configuration blocker.

## Release-blocking evidence still required
- authenticated cross-user memory/document isolation tests
- prompt/document/web injection adversarial suite
- SSRF, path traversal, upload abuse, XSS/CSRF, SQL/command injection tests
- tool authorization and sandbox escape tests
- current production deployment verification

No security PASS is claimed for the incomplete adversarial matrix.

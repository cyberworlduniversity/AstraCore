# Two-user AstraCore application API isolation test

This staging-only integration test logs in two separate test accounts through AstraCore's own `/api/auth/login` endpoint. It then creates disposable User A fixtures through the application API and checks that User B cannot list, read, or delete those records.

## Safety requirements

- Use a dedicated staging deployment connected to a dedicated staging Supabase project.
- Set `ASTRACORE_API_RLS_TARGET=staging`; the test refuses to run otherwise.
- Use two distinct, non-admin staging accounts.
- Never put credentials in source code. Supply them as GitHub Actions secrets.
- The script creates temporary project, memory, knowledge-document, cloud-file and conversation fixtures and removes them in a `finally` cleanup.
- Conversation fixture creation uses User A's Supabase access JWT and the Supabase anon/publishable key. It does not use a service-role key.
- Do not point this test at production or real customer accounts.

## GitHub Actions secrets

- `ASTRACORE_API_RLS_TARGET=staging`
- `ASTRACORE_API_BASE_URL=https://<staging-astracore-host>`
- `ASTRACORE_API_USER_A_EMAIL`
- `ASTRACORE_API_USER_A_PASSWORD`
- `ASTRACORE_API_USER_B_EMAIL`
- `ASTRACORE_API_USER_B_PASSWORD`
- `ASTRACORE_API_SUPABASE_URL=https://<staging-project>.supabase.co`
- `ASTRACORE_API_SUPABASE_ANON_KEY`
- `ASTRACORE_API_USER_A_JWT`

Run locally in a controlled staging environment with `npm run test:api-rls`. If any required value is missing, the script prints SKIP and makes no requests.

## Coverage

- Confirms two different accounts can log in through AstraCore and that `/api/auth/me` returns the correct identities.
- Verifies cross-user isolation for conversation list/read/delete, memory list/delete, knowledge list/delete, project list/delete, and file list/download/delete routes.
- Confirms User A retains access to their own fixtures after User B's denied requests.
- If a production-ready model is loaded, sends a short chat request and verifies the resulting conversation is visible to User A but not User B.
- If the model is not ready, verifies `/api/chat` returns HTTP 503 without creating a conversation. This validates the model gate, not chat generation or cross-user chat writes.

A skipped test is not a pass. A successful test proves the listed API behavior only for the tested staging deployment and accounts; it is not a substitute for full production penetration testing.

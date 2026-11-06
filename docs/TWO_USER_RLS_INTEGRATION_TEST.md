# Two-user Supabase RLS integration test

This test checks real Supabase Row Level Security using two separate, non-admin test accounts. It exercises direct Data API and Storage access, not a mocked database.

## Safety requirements

- Use a dedicated **staging** Supabase project only.
- Set `ASTRACORE_RLS_TARGET=staging`. The script refuses to run without this exact value.
- Use two distinct, non-admin test-user access JWTs.
- Supply only the Supabase anon/publishable key. Never use a service-role key.
- The test creates temporary rows and one small text object, then removes them as User A in a `finally` cleanup.
- Do not use real customer accounts or production data.

## Environment variables

- `ASTRACORE_RLS_TARGET=staging`
- `ASTRACORE_SUPABASE_URL=https://<staging-project>.supabase.co`
- `ASTRACORE_SUPABASE_ANON_KEY=<staging-anon-or-publishable-key>`
- `ASTRACORE_RLS_USER_A_JWT=<access-token-for-staging-user-a>`
- `ASTRACORE_RLS_USER_B_JWT=<different-access-token-for-staging-user-b>`

Run with `npm run test:rls`.

If any variable is missing, the script prints an explicit SKIP and exits without making requests. GitHub Actions runs this command on CI; add the five values above as repository Actions secrets to enable the live staging test. Keep `ASTRACORE_RLS_TARGET` set to `staging`.

## Coverage

For conversations, messages, memory, projects, knowledge documents, knowledge chunks and cloud-file metadata, the test verifies User B cannot read, update or delete a row owned by User A, while User A retains access. It also tries to insert a project while spoofing User A's `user_id`.

For the `astracore-files` Storage bucket, it verifies User A can upload and download a temporary object while User B cannot download or delete it.

## Limits

A skipped test is not a security pass. A successful run proves the tested RLS behavior for this staging project and these tables; it does not prove every API route, production deployment, signed-download workflow, or application session flow. Review the full CI result and keep the separate API-level regression tests.

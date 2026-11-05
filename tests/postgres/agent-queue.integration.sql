-- Disposable PostgreSQL integration test for AstraCore's durable agent queue.
-- Runs only in CI against an ephemeral PostgreSQL service; never targets Supabase.
\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb;
$$;

\ir ../../supabase/migrations/20261105130000_harden_admin_rls_helper.sql

-- Minimal disposable fixtures for the duplicate-admin-policy migration test.
create table public.astracore_lm_training_runs (id uuid primary key);
create table public.astracore_model_versions (id uuid primary key);
create table public.astracore_model_registry (id uuid primary key);

create policy admin_training_control on public.astracore_lm_training_runs
  for all to authenticated
  using ((select public.astracore_is_admin()))
  with check ((select public.astracore_is_admin()));
create policy training_runs_admin_insert on public.astracore_lm_training_runs
  for insert to authenticated
  with check (lower(coalesce((select auth.jwt())->>'email','')) = 'ehemanathan143@gmail.com');
create policy training_runs_admin_select on public.astracore_lm_training_runs
  for select to authenticated
  using (lower(coalesce((select auth.jwt())->>'email','')) = 'ehemanathan143@gmail.com');
create policy training_runs_admin_update on public.astracore_lm_training_runs
  for update to authenticated
  using (lower(coalesce((select auth.jwt())->>'email','')) = 'ehemanathan143@gmail.com')
  with check (lower(coalesce((select auth.jwt())->>'email','')) = 'ehemanathan143@gmail.com');

create policy admin_model_versions_control on public.astracore_model_versions
  for all to authenticated
  using ((select public.astracore_is_admin()))
  with check ((select public.astracore_is_admin()));
create policy model_versions_admin_delete on public.astracore_model_versions
  for delete to authenticated
  using (lower(coalesce((select auth.jwt())->>'email','')) = 'ehemanathan143@gmail.com');
create policy model_versions_admin_insert on public.astracore_model_versions
  for insert to authenticated
  with check (lower(coalesce((select auth.jwt())->>'email','')) = 'ehemanathan143@gmail.com');
create policy model_versions_admin_read on public.astracore_model_versions
  for select to authenticated
  using (lower(coalesce((select auth.jwt())->>'email','')) = 'ehemanathan143@gmail.com');
create policy model_versions_admin_update on public.astracore_model_versions
  for update to authenticated
  using (lower(coalesce((select auth.jwt())->>'email','')) = 'ehemanathan143@gmail.com')
  with check (lower(coalesce((select auth.jwt())->>'email','')) = 'ehemanathan143@gmail.com');

create policy admin_model_registry_control on public.astracore_model_registry
  for all to authenticated
  using ((select public.astracore_is_admin()))
  with check ((select public.astracore_is_admin()));
create policy astracore_models_admin on public.astracore_model_registry
  for select to authenticated
  using ((select public.astracore_is_admin()));

\ir ../../supabase/migrations/20261105140000_remove_duplicate_admin_rls_policies.sql

do $
begin
  if exists (
    select 1 from pg_policies
    where schemaname='public'
      and policyname in (
        'training_runs_admin_insert','training_runs_admin_select','training_runs_admin_update',
        'model_versions_admin_delete','model_versions_admin_insert','model_versions_admin_read','model_versions_admin_update',
        'astracore_models_admin'
      )
  ) then
    raise exception 'duplicate legacy admin policies were not removed';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='admin_training_control')
     or not exists (select 1 from pg_policies where schemaname='public' and policyname='admin_model_versions_control')
     or not exists (select 1 from pg_policies where schemaname='public' and policyname='admin_model_registry_control') then
    raise exception 'canonical admin policies were unexpectedly removed';
  end if;
end;
$;

create table public.astracore_agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_type text not null,
  status text not null check (status in ('planned','running','completed','failed','blocked')),
  plan jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.astracore_knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  title text not null,
  source text not null,
  url text
);
create table public.astracore_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.astracore_knowledge_documents(id),
  user_id uuid not null references auth.users(id),
  chunk_index integer not null,
  content text not null
);

insert into auth.users(id) values
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');

\ir ../../supabase/migrations/20261105090000_add_durable_agent_run_state.sql
\ir ../../supabase/migrations/20261105100000_reconcile_stale_agent_runs.sql
\ir ../../supabase/migrations/20261105110000_add_agent_job_leases.sql
\ir ../../supabase/migrations/20261105120000_agent_queue_atomic_rpcs.sql

do $$
declare
  u uuid := '11111111-1111-4111-8111-111111111111';
  r uuid;
  j uuid;
  r2 uuid;
  j2 uuid;
  claimed public.astracore_agent_jobs%rowtype;
  token_old uuid;
  result_status text;
  run_state text;
begin
  select x.run_id, x.job_id into r,j
  from public.create_astracore_agent_run_and_enqueue(
    u,'general','{"task":"integration task"}','idempotency-1',2
  ) x;
  if r is null or j is null then raise exception 'enqueue did not return ids'; end if;

  select x.run_id, x.job_id into r2,j2
  from public.create_astracore_agent_run_and_enqueue(
    u,'general','{"task":"integration task"}','idempotency-1',2
  ) x;
  if r2 <> r or j2 <> j then raise exception 'idempotent enqueue created duplicate rows'; end if;

  select * into claimed from public.claim_astracore_agent_jobs('worker-a',1,120);
  if claimed.id <> j or claimed.status <> 'leased' then raise exception 'job was not claimed'; end if;
  token_old := claimed.lease_token;

  if public.heartbeat_astracore_agent_job(j,'worker-b',token_old,120) then
    raise exception 'wrong worker unexpectedly renewed lease';
  end if;
  if not public.persist_astracore_agent_run_progress(j,'worker-a',token_old,'{"phase":"working"}') then
    raise exception 'valid lease could not persist progress';
  end if;

  if public.request_astracore_agent_run_cancel(u,r) <> 'requested' then
    raise exception 'cancellation request failed';
  end if;
  result_status := public.finalize_astracore_agent_job(
    j,'worker-a',token_old,'{"status":"completed","execution":{"answer":"done"}}','{"phase":"done"}'
  );
  if result_status <> 'cancelled' then raise exception 'cancellation race was not respected: %', result_status; end if;
  if (select status from public.astracore_agent_jobs where id=j) <> 'succeeded' then
    raise exception 'cancelled run job was not finalized';
  end if;
  if (select status from public.astracore_agent_runs where id=r) <> 'cancelled' then
    raise exception 'run was not marked cancelled';
  end if;

  select x.run_id, x.job_id into r2,j2
  from public.create_astracore_agent_run_and_enqueue(
    u,'research','{"task":"dead letter task"}','idempotency-2',1
  ) x;
  select * into claimed from public.claim_astracore_agent_jobs('worker-b',1,120);
  if claimed.id <> j2 then raise exception 'second job was not claimed'; end if;
  result_status := public.fail_astracore_agent_job(j2,'worker-b',claimed.lease_token,'expected test failure',false);
  if result_status <> 'dead_letter' then raise exception 'non-retryable failure did not dead-letter'; end if;
  if (select status from public.astracore_agent_runs where id=r2) <> 'failed' then
    raise exception 'dead-letter did not fail associated run';
  end if;

  select x.run_id, x.job_id into r,j
  from public.create_astracore_agent_run_and_enqueue(
    u,'general','{"task":"lease expiry task"}','idempotency-3',2
  ) x;
  select * into claimed from public.claim_astracore_agent_jobs('worker-old',1,120);
  if claimed.id <> j then raise exception 'lease expiry job was not claimed'; end if;
  token_old := claimed.lease_token;
  update public.astracore_agent_jobs set lease_expires_at=now()-interval '1 second' where id=j;
  select * into claimed from public.claim_astracore_agent_jobs('worker-new',1,120);
  if claimed.id <> j or claimed.lease_token = token_old then
    raise exception 'expired lease was not replaced with a new token';
  end if;
  if public.heartbeat_astracore_agent_job(j,'worker-old',token_old,120) then
    raise exception 'stale lease token unexpectedly remained valid';
  end if;

  if has_table_privilege('authenticated','public.astracore_agent_runs','UPDATE') then
    raise exception 'authenticated role retained direct UPDATE on agent runs';
  end if;
  if not has_table_privilege('authenticated','public.astracore_agent_runs','SELECT') then
    raise exception 'authenticated role lost run SELECT';
  end if;
  if has_table_privilege('authenticated','public.astracore_agent_runs','INSERT') then
    raise exception 'authenticated role retained direct INSERT on agent runs';
  end if;
  if has_table_privilege('authenticated','public.astracore_agent_runs','DELETE') then
    raise exception 'authenticated role retained direct DELETE on agent runs';
  end if;
  if has_table_privilege('anon','public.astracore_agent_runs','SELECT')
     or has_table_privilege('anon','public.astracore_agent_runs','INSERT') then
    raise exception 'anonymous role retained agent-run table privileges';
  end if;
  if not has_function_privilege('authenticated','public.astracore_is_admin()','EXECUTE') then
    raise exception 'authenticated role cannot evaluate admin RLS policy';
  end if;
  if has_function_privilege('anon','public.astracore_is_admin()','EXECUTE') then
    raise exception 'anonymous role can execute admin RLS helper';
  end if;
  if (select prosecdef from pg_proc where oid='public.astracore_is_admin()'::regprocedure) then
    raise exception 'admin RLS helper must not run as SECURITY DEFINER';
  end if;
  perform set_config('request.jwt.claims','{"email":"ehemanathan143@gmail.com"}',true);
  if not public.astracore_is_admin() then
    raise exception 'admin RLS helper did not recognize the configured admin claim';
  end if;
  perform set_config('request.jwt.claims','{"email":"other@example.com"}',true);
  if public.astracore_is_admin() then
    raise exception 'admin RLS helper accepted a non-admin claim';
  end if;

  raise notice 'AstraCore PostgreSQL queue integration checks passed';
end $$;

\ir agent-worker-lifecycle.integration.sql

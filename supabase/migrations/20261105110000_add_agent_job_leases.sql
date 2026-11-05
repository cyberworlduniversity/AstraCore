-- Durable agent job queue foundation. This queue is intentionally separate from
-- astracore_agent_runs until the API is migrated to enqueue rather than execute inline.
create table if not exists public.astracore_agent_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid,
  idempotency_key text,
  payload jsonb not null,
  status text not null default 'queued'
    check (status in ('queued', 'leased', 'succeeded', 'dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint astracore_agent_jobs_lease_shape check (
    (status = 'leased' and lease_owner is not null and lease_token is not null and lease_expires_at is not null)
    or status <> 'leased'
  )
);

create unique index if not exists astracore_agent_jobs_idempotency_idx
  on public.astracore_agent_jobs(user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists astracore_agent_jobs_claim_idx
  on public.astracore_agent_jobs(status, available_at, created_at);

create index if not exists astracore_agent_jobs_lease_expiry_idx
  on public.astracore_agent_jobs(lease_expires_at)
  where status = 'leased';

alter table public.astracore_agent_jobs enable row level security;
revoke all on public.astracore_agent_jobs from anon, authenticated;
grant all on public.astracore_agent_jobs to service_role;

create or replace function public.claim_astracore_agent_jobs(
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 120
)
returns setof public.astracore_agent_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_worker_id is null or length(trim(p_worker_id)) < 1 or length(p_worker_id) > 128 then
    raise exception 'invalid worker id';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 25 then
    raise exception 'claim limit must be between 1 and 25';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 15 or p_lease_seconds > 900 then
    raise exception 'lease duration must be between 15 and 900 seconds';
  end if;

  return query
  with candidates as (
    select jobs.id
    from public.astracore_agent_jobs as jobs
    where jobs.attempts < jobs.max_attempts
      and (
        (jobs.status = 'queued' and jobs.available_at <= now())
        or (jobs.status = 'leased' and jobs.lease_expires_at < now())
      )
    order by jobs.available_at asc, jobs.created_at asc
    limit p_limit
    for update skip locked
  )
  update public.astracore_agent_jobs as jobs
  set status = 'leased',
      attempts = jobs.attempts + 1,
      lease_owner = trim(p_worker_id),
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(),
      updated_at = now()
  from candidates
  where jobs.id = candidates.id
  returning jobs.*;
end;
$$;

create or replace function public.heartbeat_astracore_agent_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_lease_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer;
begin
  if p_lease_seconds is null or p_lease_seconds < 15 or p_lease_seconds > 900 then
    raise exception 'lease duration must be between 15 and 900 seconds';
  end if;
  update public.astracore_agent_jobs
  set heartbeat_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where id = p_job_id
    and status = 'leased'
    and lease_owner = p_worker_id
    and lease_token = p_lease_token
    and lease_expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.complete_astracore_agent_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer;
begin
  update public.astracore_agent_jobs
  set status = 'succeeded',
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      finished_at = now(),
      heartbeat_at = now(),
      updated_at = now(),
      last_error = null
  where id = p_job_id
    and status = 'leased'
    and lease_owner = p_worker_id
    and lease_token = p_lease_token
    and lease_expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.fail_astracore_agent_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_error text,
  p_retryable boolean default true
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.astracore_agent_jobs%rowtype;
  v_next_status text;
begin
  select * into v_job
  from public.astracore_agent_jobs
  where id = p_job_id
    and status = 'leased'
    and lease_owner = p_worker_id
    and lease_token = p_lease_token
    and lease_expires_at > now()
  for update;

  if not found then
    return 'lease_lost';
  end if;

  v_next_status := case
    when p_retryable and v_job.attempts < v_job.max_attempts then 'queued'
    else 'dead_letter'
  end;

  update public.astracore_agent_jobs
  set status = v_next_status,
      available_at = case
        when v_next_status = 'queued' then now() + make_interval(secs => least(300, 5 * power(2, greatest(v_job.attempts - 1, 0))::integer))
        else available_at
      end,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      heartbeat_at = now(),
      updated_at = now(),
      finished_at = case when v_next_status = 'dead_letter' then now() else null end,
      last_error = left(coalesce(p_error, 'Worker reported an unspecified error'), 500)
  where id = p_job_id;

  return v_next_status;
end;
$$;

create or replace function public.dead_letter_exhausted_astracore_agent_jobs(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'limit must be between 1 and 500';
  end if;
  with exhausted as (
    select id
    from public.astracore_agent_jobs
    where status = 'leased'
      and lease_expires_at < now()
      and attempts >= max_attempts
    order by lease_expires_at
    limit p_limit
    for update skip locked
  )
  update public.astracore_agent_jobs as jobs
  set status = 'dead_letter',
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      finished_at = now(),
      heartbeat_at = now(),
      updated_at = now(),
      last_error = coalesce(jobs.last_error, 'Worker lease expired after maximum attempts')
  from exhausted
  where jobs.id = exhausted.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.claim_astracore_agent_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.heartbeat_astracore_agent_job(uuid, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_astracore_agent_job(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.fail_astracore_agent_job(uuid, text, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.dead_letter_exhausted_astracore_agent_jobs(integer) from public, anon, authenticated;

grant execute on function public.claim_astracore_agent_jobs(text, integer, integer) to service_role;
grant execute on function public.heartbeat_astracore_agent_job(uuid, text, uuid, integer) to service_role;
grant execute on function public.complete_astracore_agent_job(uuid, text, uuid) to service_role;
grant execute on function public.fail_astracore_agent_job(uuid, text, uuid, text, boolean) to service_role;
grant execute on function public.dead_letter_exhausted_astracore_agent_jobs(integer) to service_role;

comment on table public.astracore_agent_jobs is
  'Service-managed durable queue. Not yet connected to the synchronous /api/agents execution path.';

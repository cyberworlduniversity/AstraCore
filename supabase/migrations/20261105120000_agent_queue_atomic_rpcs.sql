-- Atomic queue entry and completion for authenticated agent runs.
-- These functions are server-only and must be called with the Supabase service role.
create unique index if not exists astracore_agent_jobs_run_idx
  on public.astracore_agent_jobs(run_id)
  where run_id is not null;

create or replace function public.create_astracore_agent_run_and_enqueue(
  p_user_id uuid,
  p_agent_type text,
  p_plan jsonb,
  p_idempotency_key text,
  p_max_attempts integer default 3
)
returns table(run_id uuid, job_id uuid, run_status text, job_status text, created boolean)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_existing public.astracore_agent_jobs%rowtype;
  v_run_id uuid;
  v_job_id uuid;
  v_agent_type text;
  v_task text;
begin
  if p_user_id is null then raise exception 'user id is required'; end if;
  if p_agent_type is null or p_agent_type not in ('general', 'research', 'coding', 'data', 'knowledge') then
    raise exception 'invalid agent type';
  end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' or octet_length(p_plan::text) > 16384 then
    raise exception 'invalid or oversized agent plan';
  end if;
  v_task := p_plan->>'task';
  if v_task is null or length(trim(v_task)) < 1 or length(v_task) > 4000 then
    raise exception 'agent task must contain 1 to 4000 characters';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 1 or length(p_idempotency_key) > 128 then
    raise exception 'idempotency key must contain 1 to 128 characters';
  end if;
  if p_max_attempts is null or p_max_attempts < 1 or p_max_attempts > 10 then
    raise exception 'max attempts must be between 1 and 10';
  end if;

  v_agent_type := p_agent_type;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_idempotency_key, 0));

  select * into v_existing
  from public.astracore_agent_jobs
  where user_id = p_user_id and idempotency_key = trim(p_idempotency_key);

  if found then
    if v_existing.run_id is null then raise exception 'idempotency key is already assigned'; end if;
    return query
      select v_existing.run_id, v_existing.id,
        (select runs.status from public.astracore_agent_runs as runs where runs.id = v_existing.run_id and runs.user_id = p_user_id),
        v_existing.status, false;
    return;
  end if;

  insert into public.astracore_agent_runs (
    user_id, agent_type, status, plan, result,
    execution_state, started_at, heartbeat_at, finished_at, cancel_requested_at
  ) values (
    p_user_id, v_agent_type, 'running', p_plan,
    jsonb_build_object('execution', 'queued'),
    jsonb_build_object('phase', 'queued', 'steps_completed', 0, 'tool_calls_completed', 0),
    now(), now(), null, null
  ) returning id into v_run_id;

  insert into public.astracore_agent_jobs (
    user_id, run_id, idempotency_key, payload, status, attempts, max_attempts
  ) values (
    p_user_id, v_run_id, trim(p_idempotency_key),
    jsonb_build_object('task', v_task, 'agent_type', v_agent_type),
    'queued', 0, p_max_attempts
  ) returning id into v_job_id;

  return query select v_run_id, v_job_id, 'running'::text, 'queued'::text, true;
end;
$$;

create or replace function public.persist_astracore_agent_run_progress(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_execution_state jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_job public.astracore_agent_jobs%rowtype;
  v_updated integer;
begin
  if p_execution_state is null or jsonb_typeof(p_execution_state) <> 'object'
     or octet_length(p_execution_state::text) > 8192 then
    raise exception 'execution state must be an object up to 8 KiB';
  end if;

  select * into v_job
  from public.astracore_agent_jobs
  where id = p_job_id and status = 'leased'
    and lease_owner = p_worker_id and lease_token = p_lease_token
    and lease_expires_at > now()
  for update;
  if not found then return false; end if;

  update public.astracore_agent_runs
  set execution_state = p_execution_state, heartbeat_at = now()
  where id = v_job.run_id and user_id = v_job.user_id
    and status = 'running' and finished_at is null;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.finalize_astracore_agent_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_result jsonb,
  p_execution_state jsonb default '{}'::jsonb
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_job public.astracore_agent_jobs%rowtype;
  v_run public.astracore_agent_runs%rowtype;
  v_status text;
  v_final_result jsonb;
  v_state jsonb;
  v_updated integer;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object'
     or octet_length(p_result::text) > 1048576 then
    raise exception 'result must be an object up to 1 MiB';
  end if;
  if p_execution_state is null or jsonb_typeof(p_execution_state) <> 'object'
     or octet_length(p_execution_state::text) > 8192 then
    raise exception 'execution state must be an object up to 8 KiB';
  end if;
  if coalesce(p_result->>'status', '') not in ('completed', 'cancelled', 'already_finished') then
    raise exception 'unsupported final run status';
  end if;

  select * into v_job
  from public.astracore_agent_jobs
  where id = p_job_id and status = 'leased'
    and lease_owner = p_worker_id and lease_token = p_lease_token
    and lease_expires_at > now()
  for update;
  if not found then return 'lease_lost'; end if;

  select * into v_run
  from public.astracore_agent_runs
  where id = v_job.run_id and user_id = v_job.user_id
  for update;
  if not found then return 'run_not_active'; end if;
  if v_run.finished_at is not null or v_run.status in ('completed', 'failed', 'blocked') then
    update public.astracore_agent_jobs
    set status = 'succeeded', lease_owner = null, lease_token = null, lease_expires_at = null,
        heartbeat_at = now(), updated_at = now(), finished_at = now(), last_error = null
    where id = v_job.id;
    return 'already_finished';
  end if;
  if v_run.status not in ('running', 'cancelled') then return 'run_not_active'; end if;
  if p_result->>'status' = 'already_finished' then
    update public.astracore_agent_jobs
    set status = 'succeeded', lease_owner = null, lease_token = null, lease_expires_at = null,
        heartbeat_at = now(), updated_at = now(), finished_at = now(), last_error = null
    where id = v_job.id;
    return 'already_finished';
  end if;

  v_status := case
    when v_run.cancel_requested_at is not null
      or v_run.status = 'cancelled'
      or p_result->>'status' = 'cancelled' then 'cancelled'
    else 'completed'
  end;

  if v_status = 'cancelled' then
    v_final_result := jsonb_build_object('execution', 'cancelled');
    v_state := jsonb_build_object('phase', 'cancelled');
  else
    v_final_result := jsonb_build_object('execution', 'completed')
      || coalesce(p_result->'execution', '{}'::jsonb);
    v_state := p_execution_state;
  end if;

  update public.astracore_agent_runs
  set status = v_status,
      result = v_final_result,
      execution_state = v_state,
      heartbeat_at = now(),
      finished_at = now(),
      last_error = null
  where id = v_run.id and user_id = v_run.user_id
    and finished_at is null;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then return 'run_not_active'; end if;

  update public.astracore_agent_jobs
  set status = 'succeeded',
      lease_owner = null, lease_token = null, lease_expires_at = null,
      heartbeat_at = now(), updated_at = now(), finished_at = now(), last_error = null
  where id = v_job.id;
  return v_status;
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
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_job public.astracore_agent_jobs%rowtype;
  v_next_status text;
  v_error text;
begin
  select * into v_job
  from public.astracore_agent_jobs
  where id = p_job_id and status = 'leased'
    and lease_owner = p_worker_id and lease_token = p_lease_token
    and lease_expires_at > now()
  for update;

  if not found then return 'lease_lost'; end if;

  v_next_status := case
    when p_retryable and v_job.attempts < v_job.max_attempts then 'queued'
    else 'dead_letter'
  end;
  v_error := left(coalesce(p_error, 'Worker reported an unspecified error'), 500);

  update public.astracore_agent_jobs
  set status = v_next_status,
      available_at = case
        when v_next_status = 'queued' then now() + make_interval(secs => least(300, 5 * power(2, greatest(v_job.attempts - 1, 0))::integer))
        else available_at
      end,
      lease_owner = null, lease_token = null, lease_expires_at = null,
      heartbeat_at = now(), updated_at = now(),
      finished_at = case when v_next_status = 'dead_letter' then now() else null end,
      last_error = v_error
  where id = p_job_id;

  if v_next_status = 'dead_letter' then
    update public.astracore_agent_runs
    set status = case when cancel_requested_at is not null then 'cancelled' else 'failed' end,
        result = jsonb_build_object('execution', case when cancel_requested_at is not null then 'cancelled' else 'failed' end),
        execution_state = jsonb_build_object('phase', case when cancel_requested_at is not null then 'cancelled' else 'failed' end),
        heartbeat_at = now(), finished_at = now(),
        last_error = case when cancel_requested_at is not null then null else v_error end
    where id = v_job.run_id and user_id = v_job.user_id and finished_at is null;
  else
    update public.astracore_agent_runs
    set execution_state = jsonb_build_object('phase', 'retry_wait', 'attempts', v_job.attempts, 'last_error', v_error),
        heartbeat_at = now(), last_error = v_error
    where id = v_job.run_id and user_id = v_job.user_id and finished_at is null;
  end if;

  return v_next_status;
end;
$$;

revoke all on function public.create_astracore_agent_run_and_enqueue(uuid, text, jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.persist_astracore_agent_run_progress(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_astracore_agent_job(uuid, text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.fail_astracore_agent_job(uuid, text, uuid, text, boolean) from public, anon, authenticated;

grant execute on function public.create_astracore_agent_run_and_enqueue(uuid, text, jsonb, text, integer) to service_role;
grant execute on function public.persist_astracore_agent_run_progress(uuid, text, uuid, jsonb) to service_role;
grant execute on function public.finalize_astracore_agent_job(uuid, text, uuid, jsonb, jsonb) to service_role;
grant execute on function public.fail_astracore_agent_job(uuid, text, uuid, text, boolean) to service_role;

comment on function public.create_astracore_agent_run_and_enqueue(uuid, text, jsonb, text, integer) is
  'Atomically creates one user-owned agent run and its queued job; service-role only.';
comment on function public.finalize_astracore_agent_job(uuid, text, uuid, jsonb, jsonb) is
  'Atomically persists a leased worker result and marks the corresponding queue job succeeded.';


-- Reconcile exhausted queue leases and their associated runs together.
create or replace function public.dead_letter_exhausted_astracore_agent_jobs(
  p_limit integer default 100
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_job public.astracore_agent_jobs%rowtype;
  v_count integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'limit must be between 1 and 500';
  end if;

  for v_job in
    select * from public.astracore_agent_jobs
    where status = 'leased'
      and lease_expires_at < now()
      and attempts >= max_attempts
    order by lease_expires_at
    limit p_limit
    for update skip locked
  loop
    update public.astracore_agent_jobs
    set status = 'dead_letter',
        lease_owner = null, lease_token = null, lease_expires_at = null,
        finished_at = now(), heartbeat_at = now(), updated_at = now(),
        last_error = coalesce(last_error, 'Worker lease expired after maximum attempts')
    where id = v_job.id;

    update public.astracore_agent_runs
    set status = case when cancel_requested_at is not null then 'cancelled' else 'failed' end,
        result = jsonb_build_object('execution', case when cancel_requested_at is not null then 'cancelled' else 'failed' end),
        execution_state = jsonb_build_object('phase', case when cancel_requested_at is not null then 'cancelled' else 'failed' end),
        heartbeat_at = now(), finished_at = now(),
        last_error = case when cancel_requested_at is not null then null else coalesce(v_job.last_error, 'Worker lease expired after maximum attempts') end
    where id = v_job.run_id and user_id = v_job.user_id and finished_at is null;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.dead_letter_exhausted_astracore_agent_jobs(integer) from public, anon, authenticated;
grant execute on function public.dead_letter_exhausted_astracore_agent_jobs(integer) to service_role;


-- Keep agent-run writes behind the private service-role API. Authenticated
-- users retain owner-scoped SELECT access but cannot forge run status/results.
revoke all on table public.astracore_agent_runs from anon;
revoke all on table public.astracore_agent_runs from anon, authenticated;
grant select on table public.astracore_agent_runs to authenticated;

create or replace function public.create_astracore_agent_plan(
  p_user_id uuid,
  p_agent_type text,
  p_plan jsonb
)
returns table(id uuid, status text, plan jsonb)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if p_user_id is null then raise exception 'user id is required'; end if;
  if p_agent_type is null or p_agent_type not in ('general', 'research', 'coding', 'data', 'knowledge') then
    raise exception 'invalid agent type';
  end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' or octet_length(p_plan::text) > 16384 then
    raise exception 'invalid or oversized agent plan';
  end if;
  if p_plan->>'task' is null or length(trim(p_plan->>'task')) < 1 or length(p_plan->>'task') > 4000 then
    raise exception 'agent task must contain 1 to 4000 characters';
  end if;

  insert into public.astracore_agent_runs(user_id, agent_type, status, plan, result)
  values (p_user_id, p_agent_type, 'planned', p_plan,
          jsonb_build_object('execution', 'planned_only', 'tools_authorized', false))
  returning astracore_agent_runs.id into v_id;

  return query select runs.id, runs.status, runs.plan
    from public.astracore_agent_runs as runs where runs.id = v_id;
end;
$$;

create or replace function public.request_astracore_agent_run_cancel(
  p_user_id uuid,
  p_run_id uuid
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_run public.astracore_agent_runs%rowtype;
begin
  if p_user_id is null or p_run_id is null then raise exception 'user and run ids are required'; end if;
  select * into v_run from public.astracore_agent_runs
  where id = p_run_id and user_id = p_user_id for update;
  if not found then return 'not_found'; end if;
  if v_run.finished_at is not null or v_run.status in ('completed', 'failed', 'blocked', 'cancelled') then
    return 'already_finished';
  end if;
  if v_run.cancel_requested_at is not null then return 'already_requested'; end if;

  update public.astracore_agent_runs
  set cancel_requested_at = now(), heartbeat_at = now()
  where id = p_run_id and user_id = p_user_id and finished_at is null;
  return 'requested';
end;
$$;

revoke all on function public.create_astracore_agent_plan(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.request_astracore_agent_run_cancel(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_astracore_agent_plan(uuid, text, jsonb) to service_role;
grant execute on function public.request_astracore_agent_run_cancel(uuid, uuid) to service_role;


-- Service-role worker search is explicitly tenant-scoped because auth.uid()
-- is not populated for a service-role request.
create or replace function public.search_astracore_knowledge_for_user(
  p_user_id uuid,
  search_query text,
  result_limit integer default 5
)
returns table(
  chunk_id uuid, document_id uuid, title text, source text, url text,
  chunk_index integer, content text, keyword_score real, combined_score real
)
language sql
stable
security invoker
set search_path = pg_catalog, public, extensions
as $$
  with keyword_hits as (
    select c.id as chunk_id, c.document_id, d.title, d.source, d.url,
      c.chunk_index, c.content,
      ts_rank(
        to_tsvector('simple', c.content),
        websearch_to_tsquery('simple', search_query)
      )::real as keyword_score
    from public.astracore_knowledge_chunks as c
    join public.astracore_knowledge_documents as d on d.id = c.document_id
    where c.user_id = p_user_id
      and search_query is not null
      and length(search_query) between 1 and 2000
      and to_tsvector('simple', c.content) @@ websearch_to_tsquery('simple', search_query)
    order by keyword_score desc
    limit greatest(1, least(coalesce(result_limit, 5), 20))
  )
  select chunk_id, document_id, title, source, url, chunk_index, content,
    keyword_score, keyword_score as combined_score
  from keyword_hits
  order by keyword_score desc
  limit greatest(1, least(coalesce(result_limit, 5), 20));
$$;

revoke all on function public.search_astracore_knowledge_for_user(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.search_astracore_knowledge_for_user(uuid, text, integer) to service_role;

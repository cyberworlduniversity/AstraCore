-- Safely close abandoned synchronous agent runs after a worker/API crash.
-- This function is an operational primitive; it is NOT scheduled automatically.
create or replace function public.reconcile_stale_astracore_agent_runs(
  p_stale_after interval default interval '5 minutes',
  p_batch_size integer default 100
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_reconciled integer := 0;
begin
  if p_stale_after is null or p_stale_after < interval '1 minute'
     or p_stale_after > interval '1 day' then
    raise exception 'p_stale_after must be between 1 minute and 1 day';
  end if;

  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 500 then
    raise exception 'p_batch_size must be between 1 and 500';
  end if;

  with stale_runs as (
    select ctid
    from public.astracore_agent_runs
    where status = 'running'
      and finished_at is null
      and coalesce(heartbeat_at, started_at, created_at) < now() - p_stale_after
    order by coalesce(heartbeat_at, started_at, created_at) asc
    limit p_batch_size
    for update skip locked
  )
  update public.astracore_agent_runs as runs
  set
    status = case
      when runs.cancel_requested_at is not null then 'cancelled'
      else 'failed'
    end,
    result = coalesce(runs.result, '{}'::jsonb) || jsonb_build_object(
      'execution',
      case when runs.cancel_requested_at is not null then 'cancelled' else 'failed' end,
      'failure_code',
      case when runs.cancel_requested_at is not null then null else 'AGENT_RUN_WORKER_LOST' end
    ),
    execution_state = coalesce(runs.execution_state, '{}'::jsonb) || jsonb_build_object(
      'phase',
      case when runs.cancel_requested_at is not null then 'cancelled' else 'failed' end,
      'reconciled',
      true
    ),
    last_error = case
      when runs.cancel_requested_at is not null then null
      else 'Agent worker heartbeat expired; run closed by stale-run reconciliation.'
    end,
    finished_at = now(),
    heartbeat_at = now()
  from stale_runs
  where runs.ctid = stale_runs.ctid;

  get diagnostics v_reconciled = row_count;
  return v_reconciled;
end;
$$;

revoke all on function public.reconcile_stale_astracore_agent_runs(interval, integer) from public, anon, authenticated;
grant execute on function public.reconcile_stale_astracore_agent_runs(interval, integer) to service_role;

comment on function public.reconcile_stale_astracore_agent_runs(interval, integer) is
  'Service-role-only bounded reconciliation of stale running agent rows. Uses row locks with SKIP LOCKED; not scheduled automatically.';

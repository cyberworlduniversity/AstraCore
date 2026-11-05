-- Durable, inspectable agent execution state. This migration is additive and safe to re-run.
alter table if exists public.astracore_agent_runs
  add column if not exists execution_state jsonb not null default '{}'::jsonb,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists last_error text;

-- Preserve the existing planned/running/completed/failed/blocked states while
-- allowing cooperative cancellation introduced by the durable-run API.
alter table public.astracore_agent_runs
  drop constraint if exists astracore_agent_runs_status_check;
alter table public.astracore_agent_runs
  add constraint astracore_agent_runs_status_check
  check (status in ('planned', 'running', 'completed', 'failed', 'blocked', 'cancelled'));

-- Backfill the new lifecycle timestamps from the legacy completed_at column.
update public.astracore_agent_runs
set started_at = case when status = 'running' then coalesce(started_at, created_at) else started_at end,
    heartbeat_at = case when status = 'running' then coalesce(heartbeat_at, created_at) else heartbeat_at end,
    finished_at = case
      when status in ('completed', 'failed', 'blocked', 'cancelled') then coalesce(finished_at, completed_at, created_at)
      else finished_at
    end;

create index if not exists astracore_agent_runs_user_recent_idx
  on public.astracore_agent_runs (user_id, created_at desc);

create index if not exists astracore_agent_runs_active_idx
  on public.astracore_agent_runs (user_id, started_at desc)
  where finished_at is null;

comment on column public.astracore_agent_runs.execution_state is
  'Bounded progress snapshot for a durable agent run; must not contain secrets or full prompts.';
comment on column public.astracore_agent_runs.cancel_requested_at is
  'User-scoped cooperative cancellation request timestamp.';

-- Durable, inspectable agent execution state. This migration is additive and safe to re-run.
alter table if exists public.astracore_agent_runs
  add column if not exists execution_state jsonb not null default '{}'::jsonb,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists last_error text;

create index if not exists astracore_agent_runs_user_recent_idx
  on public.astracore_agent_runs (user_id, created_at desc);

create index if not exists astracore_agent_runs_active_idx
  on public.astracore_agent_runs (user_id, started_at desc)
  where finished_at is null;

comment on column public.astracore_agent_runs.execution_state is
  'Bounded progress snapshot for a durable agent run; must not contain secrets or full prompts.';
comment on column public.astracore_agent_runs.cancel_requested_at is
  'User-scoped cooperative cancellation request timestamp.';

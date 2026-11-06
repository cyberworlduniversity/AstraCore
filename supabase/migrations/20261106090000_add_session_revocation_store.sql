create table if not exists public.astracore_revoked_sessions (
  session_hash text primary key check (session_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists astracore_revoked_sessions_expiry_idx
  on public.astracore_revoked_sessions (expires_at);

alter table public.astracore_revoked_sessions enable row level security;

create policy astracore_revoked_sessions_self_select
  on public.astracore_revoked_sessions
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy astracore_revoked_sessions_self_insert
  on public.astracore_revoked_sessions
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

grant select, insert on public.astracore_revoked_sessions to authenticated;

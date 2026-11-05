-- The admin helper is referenced by authenticated RLS policies.
-- Keep it invoker-safe and explicitly grant only the roles that need policy evaluation.
create or replace function public.astracore_is_admin()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, auth
as $$
  select lower(coalesce((select auth.jwt())->>'email', '')) = 'ehemanathan143@gmail.com';
$$;

revoke all on function public.astracore_is_admin() from public, anon;
grant execute on function public.astracore_is_admin() to authenticated, service_role;

comment on function public.astracore_is_admin() is
  'Read-only JWT email check used by RLS policies; invoker-security with restricted execute grants.';

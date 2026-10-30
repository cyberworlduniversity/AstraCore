drop policy if exists model_versions_admin_read on public.astracore_model_versions;
drop policy if exists model_versions_admin_write on public.astracore_model_versions;
create policy model_versions_admin_read on public.astracore_model_versions for select to authenticated using ((select lower(coalesce(auth.jwt()->>'email',''))) = lower('ehemanathan143@gmail.com'));
create policy model_versions_admin_insert on public.astracore_model_versions for insert to authenticated with check ((select lower(coalesce(auth.jwt()->>'email',''))) = lower('ehemanathan143@gmail.com'));
create policy model_versions_admin_update on public.astracore_model_versions for update to authenticated using ((select lower(coalesce(auth.jwt()->>'email',''))) = lower('ehemanathan143@gmail.com')) with check ((select lower(coalesce(auth.jwt()->>'email',''))) = lower('ehemanathan143@gmail.com'));
create policy model_versions_admin_delete on public.astracore_model_versions for delete to authenticated using ((select lower(coalesce(auth.jwt()->>'email',''))) = lower('ehemanathan143@gmail.com'));
drop policy if exists astracore_users_admin on public.astracore_users;
drop policy if exists astracore_users_self on public.astracore_users;
create policy astracore_users_read on public.astracore_users for select to authenticated using ((auth_user_id = (select auth.uid())) or (select astracore_is_admin()));

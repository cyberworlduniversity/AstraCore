create table if not exists public.astracore_projects (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 1000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists astracore_projects_user_updated_idx on public.astracore_projects(user_id, updated_at desc);
alter table public.astracore_projects enable row level security;

create table if not exists public.astracore_cloud_files (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  project_id uuid references public.astracore_projects(id) on delete set null,
  storage_path text not null unique, filename text not null check (length(trim(filename)) between 1 and 255),
  mime_type text not null default 'application/octet-stream', size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'uploaded' check (status in ('uploaded','processing','ready','failed','deleted')),
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists astracore_cloud_files_user_updated_idx on public.astracore_cloud_files(user_id, updated_at desc);
create index if not exists astracore_cloud_files_project_idx on public.astracore_cloud_files(project_id, updated_at desc);
alter table public.astracore_cloud_files enable row level security;

create or replace function public.astracore_cloud_file_project_owner() returns trigger language plpgsql security invoker set search_path = public as $$ begin if new.project_id is not null and not exists (select 1 from public.astracore_projects p where p.id = new.project_id and p.user_id = new.user_id) then raise exception 'project ownership mismatch'; end if; return new; end; $$;
drop trigger if exists astracore_cloud_file_project_owner on public.astracore_cloud_files;
create trigger astracore_cloud_file_project_owner before insert or update of project_id,user_id on public.astracore_cloud_files for each row execute function public.astracore_cloud_file_project_owner();
create or replace function public.astracore_touch_updated_at() returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists astracore_projects_touch_updated_at on public.astracore_projects;
create trigger astracore_projects_touch_updated_at before update on public.astracore_projects for each row execute function public.astracore_touch_updated_at();
drop trigger if exists astracore_cloud_files_touch_updated_at on public.astracore_cloud_files;
create trigger astracore_cloud_files_touch_updated_at before update on public.astracore_cloud_files for each row execute function public.astracore_touch_updated_at();

create policy astracore_projects_owner_select on public.astracore_projects for select using ((select auth.uid()) = user_id);
create policy astracore_projects_owner_insert on public.astracore_projects for insert with check ((select auth.uid()) = user_id);
create policy astracore_projects_owner_update on public.astracore_projects for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy astracore_projects_owner_delete on public.astracore_projects for delete using ((select auth.uid()) = user_id);
create policy astracore_cloud_files_owner_select on public.astracore_cloud_files for select using ((select auth.uid()) = user_id);
create policy astracore_cloud_files_owner_insert on public.astracore_cloud_files for insert with check ((select auth.uid()) = user_id);
create policy astracore_cloud_files_owner_update on public.astracore_cloud_files for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy astracore_cloud_files_owner_delete on public.astracore_cloud_files for delete using ((select auth.uid()) = user_id);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values ('astracore-files','astracore-files',false,10485760,array['image/*','application/pdf','text/plain','text/markdown','text/csv','application/json','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation']) on conflict (id) do update set public=false,file_size_limit=10485760;
create policy astracore_storage_select on storage.objects for select to authenticated using (bucket_id='astracore-files' and name like ((select auth.uid())::text || '/%'));
create policy astracore_storage_insert on storage.objects for insert to authenticated with check (bucket_id='astracore-files' and name like ((select auth.uid())::text || '/%'));
create policy astracore_storage_update on storage.objects for update to authenticated using (bucket_id='astracore-files' and name like ((select auth.uid())::text || '/%')) with check (bucket_id='astracore-files' and name like ((select auth.uid())::text || '/%'));
create policy astracore_storage_delete on storage.objects for delete to authenticated using (bucket_id='astracore-files' and name like ((select auth.uid())::text || '/%'));

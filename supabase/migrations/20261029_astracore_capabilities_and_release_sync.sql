create table if not exists public.astracore_capabilities (
  id text primary key,
  name text not null,
  group_name text not null,
  icon text not null,
  status text not null,
  description text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.astracore_capabilities enable row level security;

drop policy if exists "astracore_capabilities_service_only" on public.astracore_capabilities;
create policy "astracore_capabilities_service_only"
on public.astracore_capabilities
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create table if not exists public.astracore_release_sync (
  id uuid primary key default gen_random_uuid(),
  git_sha text not null unique,
  git_message text not null,
  supabase_migration text,
  vercel_status text not null default 'pending',
  vercel_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.astracore_release_sync enable row level security;

drop policy if exists "astracore_release_sync_service_only" on public.astracore_release_sync;
create policy "astracore_release_sync_service_only"
on public.astracore_release_sync
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

insert into public.astracore_capabilities (id,name,group_name,icon,status,description,sort_order) values
('chat','Astra AI','Core','sparkles','available','Chat with the AstraCore neural inference layer.',10),
('image','Image Studio','Create','image','interface-ready','Image generation, editing and vision workflows.',20),
('video','Video Studio','Create','video','interface-ready','Video creation, analysis and media workflows.',30),
('audio','Audio Studio','Create','audio','interface-ready','Audio generation, transcription and analysis workflows.',40),
('voice','Voice Studio','Create','voice','available','Speech input and AstraCore read-aloud controls.',50),
('document','Document Studio','Create','document','interface-ready','Document upload, preview and analysis pipeline.',60),
('code','Code Studio','Work','code','available','Coding, debugging and software-engineering workflows.',70),
('data','Data Studio','Work','data','planned','Structured data analysis and chart workflows.',80),
('canvas','Canvas','Work','canvas','planned','Editable document and code workspace.',90),
('search','Astra Search','Research','search','planned','Evidence-based web search with citations.',100),
('research','Deep Research','Research','research','planned','Multi-step research planning and synthesis.',110),
('projects','Projects','Workspace','folder','interface-ready','Persistent chats, files, instructions and memory.',120),
('memory','Memory','Workspace','memory','interface-ready','User, project and conversation memory controls.',130),
('agents','Astra Agents','Workspace','agent','interface-ready','Tool-using agents with permissions and skills.',140),
('tasks','Tasks & Automation','Workspace','tasks','planned','Approved scheduled and repeatable workflows.',150),
('models','Model Center','AI','model','available','Manage AstraCore model profiles and checkpoints.',160),
('library','Knowledge Library','AI','library','planned','Searchable user-owned knowledge and source files.',170)
on conflict (id) do update set name=excluded.name,group_name=excluded.group_name,icon=excluded.icon,status=excluded.status,description=excluded.description,sort_order=excluded.sort_order,updated_at=now();

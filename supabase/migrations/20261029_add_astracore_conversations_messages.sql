create table if not exists public.astracore_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation',
  model text not null default 'astracore-neural-a',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.astracore_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.astracore_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index if not exists astracore_conversations_user_updated_idx on public.astracore_conversations(user_id, updated_at desc);
create index if not exists astracore_messages_conversation_created_idx on public.astracore_messages(conversation_id, created_at);
create index if not exists astracore_messages_user_created_idx on public.astracore_messages(user_id, created_at desc);
alter table public.astracore_conversations enable row level security;
alter table public.astracore_messages enable row level security;
create policy astracore_conversations_self_select on public.astracore_conversations for select to authenticated using ((select auth.uid()) = user_id);
create policy astracore_conversations_self_insert on public.astracore_conversations for insert to authenticated with check ((select auth.uid()) = user_id);
create policy astracore_conversations_self_update on public.astracore_conversations for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy astracore_conversations_self_delete on public.astracore_conversations for delete to authenticated using ((select auth.uid()) = user_id);
create policy astracore_messages_self_select on public.astracore_messages for select to authenticated using ((select auth.uid()) = user_id);
create policy astracore_messages_self_insert on public.astracore_messages for insert to authenticated with check ((select auth.uid()) = user_id and exists (select 1 from public.astracore_conversations c where c.id = conversation_id and c.user_id = (select auth.uid())));
create policy astracore_messages_self_update on public.astracore_messages for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy astracore_messages_self_delete on public.astracore_messages for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.astracore_conversations to authenticated;
grant select, insert, update, delete on public.astracore_messages to authenticated;
create or replace function public.astracore_touch_conversation() returns trigger language plpgsql security invoker set search_path = public as $$ begin update public.astracore_conversations set updated_at = now() where id = new.conversation_id; return new; end; $$;
create trigger astracore_messages_touch_conversation after insert on public.astracore_messages for each row execute function public.astracore_touch_conversation();
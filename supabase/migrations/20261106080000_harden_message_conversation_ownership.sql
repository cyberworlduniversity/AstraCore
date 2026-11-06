-- Prevent message rows from being moved into another user's conversation.
-- The trigger also protects writes that bypass RLS, while remaining SECURITY INVOKER.
create or replace function public.astracore_assert_message_conversation_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.astracore_conversations c
    where c.id = new.conversation_id
      and c.user_id = new.user_id
  ) then
    raise exception 'Message owner must match conversation owner'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists astracore_message_owner_guard on public.astracore_messages;
create trigger astracore_message_owner_guard
before insert or update of conversation_id, user_id
on public.astracore_messages
for each row
execute function public.astracore_assert_message_conversation_owner();

drop policy if exists astracore_messages_self_update on public.astracore_messages;
create policy astracore_messages_self_update
on public.astracore_messages
for update
to authenticated
using (
  (select auth.uid()) = user_id
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.astracore_conversations c
    where c.id = conversation_id
      and c.user_id = (select auth.uid())
  )
);

create index if not exists astracore_messages_conversation_user_created_idx
  on public.astracore_messages(conversation_id, user_id, created_at);

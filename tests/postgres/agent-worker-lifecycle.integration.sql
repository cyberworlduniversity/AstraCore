-- Additional end-to-end SQL assertions for retry recovery and tenant isolation.
-- Included by agent-queue.integration.sql after all migrations are applied.
\set ON_ERROR_STOP on

insert into public.astracore_knowledge_documents(user_id,title,source)
values
 ('11111111-1111-4111-8111-111111111111','Owner document','integration'),
 ('22222222-2222-4222-8222-222222222222','Other user document','integration');

insert into public.astracore_knowledge_chunks(document_id,user_id,chunk_index,content)
select id,user_id,0,
  case when user_id='11111111-1111-4111-8111-111111111111'
    then 'Quartz falcon private project notes for owner one'
    else 'Quartz falcon confidential notes belonging to owner two'
  end
from public.astracore_knowledge_documents;

do $$
declare
  u uuid := '11111111-1111-4111-8111-111111111111';
  run_id uuid;
  job_id uuid;
  claimed public.astracore_agent_jobs%rowtype;
  outcome text;
  visible_count integer;
begin
  select count(*) into visible_count
  from public.search_astracore_knowledge_for_user(
    u,'quartz falcon',20
  );
  if visible_count <> 1 then
    raise exception 'tenant-scoped knowledge search returned % rows; expected exactly one', visible_count;
  end if;
  if exists (
    select 1 from public.search_astracore_knowledge_for_user(
      u,'quartz falcon',20
    ) where title='Other user document'
  ) then
    raise exception 'knowledge search leaked another user document';
  end if;

  select x.run_id,x.job_id into run_id,job_id
  from public.create_astracore_agent_run_and_enqueue(
    u,'general','{"task":"retry lifecycle test"}','idempotency-retry',2
  ) x;

  select * into claimed from public.claim_astracore_agent_jobs('retry-worker-1',1,120);
  if claimed.id <> job_id or claimed.attempts <> 1 then
    raise exception 'first retry lifecycle lease was not acquired';
  end if;
  outcome := public.fail_astracore_agent_job(
    job_id,'retry-worker-1',claimed.lease_token,'temporary integration failure',true
  );
  if outcome <> 'queued' then
    raise exception 'retryable failure should return job to queue, got %',outcome;
  end if;
  if (select status from public.astracore_agent_runs where id=run_id) <> 'running' then
    raise exception 'retryable failure incorrectly terminated the agent run';
  end if;

  update public.astracore_agent_jobs
  set available_at=now()
  where id=job_id and status='queued';
  select * into claimed from public.claim_astracore_agent_jobs('retry-worker-2',1,120);
  if claimed.id <> job_id or claimed.attempts <> 2 then
    raise exception 'second retry lifecycle lease was not acquired';
  end if;
  update public.astracore_agent_jobs
  set lease_expires_at=now()-interval '1 second'
  where id=job_id;
  if public.dead_letter_exhausted_astracore_agent_jobs(10) <> 1 then
    raise exception 'exhausted lease was not dead-lettered';
  end if;
  if (select status from public.astracore_agent_jobs where id=job_id) <> 'dead_letter' then
    raise exception 'exhausted job did not reach dead_letter';
  end if;
  if (select status from public.astracore_agent_runs where id=run_id) <> 'failed' then
    raise exception 'exhausted job did not fail its associated run';
  end if;

  if public.request_astracore_agent_run_cancel(
    '22222222-2222-4222-8222-222222222222',run_id
  ) <> 'not_found' then
    raise exception 'another user could discover or cancel this agent run';
  end if;

  raise notice 'AstraCore worker lifecycle and tenant isolation checks passed';
end $$;

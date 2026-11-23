create table manju_private.video_jobs (
  id uuid primary key,
  uid uuid not null,
  fingerprint text not null,
  remote_id uuid,
  state text not null default 'submitting' check (state in ('submitting','pending','ready','failed','expired')),
  created_at timestamptz not null default now(),
  checked_at timestamptz not null default now()
);
create index video_jobs_due on manju_private.video_jobs(checked_at) where state in ('submitting','pending');
alter table manju_private.video_jobs enable row level security;
grant select, insert, update on manju_private.video_jobs to service_role;

create function public.manju_video_begin(p_uid uuid,p_id uuid,p_units integer,p_fingerprint text)
returns text language plpgsql security invoker set search_path = '' as $$
declare job manju_private.video_jobs%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text, 18931));
  select * into job from manju_private.video_jobs where id=p_id;
  if found then
    if job.uid=p_uid and job.fingerprint=p_fingerprint then return 'existing'; end if;
    return 'conflict';
  end if;
  if not public.manju_reserve(p_uid,p_id,p_units) then return 'insufficient'; end if;
  insert into manju_private.video_jobs(id,uid,fingerprint) values(p_id,p_uid,p_fingerprint);
  return 'created';
end;
$$;

create function public.manju_video_job(p_id uuid,p_uid uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('id',id,'remote',remote_id,'state',state)
  from manju_private.video_jobs where id=p_id and uid=p_uid;
$$;

create function public.manju_video_due()
returns jsonb language sql security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'remote',remote_id,'state',state)), '[]'::jsonb)
  from (
    select id,remote_id,state from manju_private.video_jobs
    where (state='pending' and checked_at < now() - interval '30 seconds')
       or (state='submitting' and created_at < now() - interval '15 minutes')
    order by checked_at limit 12
  ) jobs;
$$;

create function public.manju_video_update(p_id uuid,p_remote uuid,p_state text)
returns text language plpgsql security invoker set search_path = '' as $$
declare job manju_private.video_jobs%rowtype;
begin
  select * into job from manju_private.video_jobs where id=p_id for update;
  if not found then return null; end if;
  if job.state not in ('submitting','pending') then return job.state; end if;
  if p_state = 'pending' and p_remote is not null and
     (job.remote_id is null or job.remote_id = p_remote) then
    update manju_private.video_jobs set remote_id=p_remote,state='pending',checked_at=now() where id=p_id;
    return 'pending';
  end if;
  if p_state in ('ready','failed','expired') then
    if job.remote_id is distinct from p_remote or (p_state='ready' and p_remote is null) then return job.state; end if;
    perform public.manju_settle(p_id,p_state='ready');
    update manju_private.video_jobs set state=p_state,checked_at=now() where id=p_id;
    return p_state;
  end if;
  return job.state;
end;
$$;

revoke execute on function public.manju_video_begin(uuid,uuid,integer,text),
  public.manju_video_job(uuid,uuid), public.manju_video_due(), public.manju_video_update(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.manju_video_begin(uuid,uuid,integer,text),
  public.manju_video_job(uuid,uuid), public.manju_video_due(), public.manju_video_update(uuid,uuid,text)
  to service_role;

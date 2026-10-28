-- Apply after 20261024_hedge_radar.sql and before the worker/API update.
begin;
alter table public.hedge_radar_state
  add column if not exists refresh_started_at timestamptz,
  add column if not exists refresh_completed_at timestamptz,
  add column if not exists refresh_deadline_at timestamptz,
  add column if not exists refresh_retry_at timestamptz,
  add column if not exists refresh_run_id bigint,
  add column if not exists refresh_run_url text,
  add column if not exists refresh_source text;
alter table public.hedge_radar_state drop constraint if exists hedge_radar_state_refresh_status_check;
alter table public.hedge_radar_state add constraint hedge_radar_state_refresh_status_check
  check(refresh_status in ('idle','queued','running','completed','failed'));

create or replace function public.reserve_hedge_radar_refresh(p_user_id uuid,p_source text default 'manual')
returns jsonb language plpgsql security definer set search_path=public as $$
declare state hedge_radar_state; wait_seconds integer;
begin
  if p_source not in ('manual','scheduled') then raise exception 'Geçersiz analiz kaynağı.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hedge_radar',0));
  select * into state from hedge_radar_state where id=1 for update;
  if state.id is not null and state.owner_user_id<>p_user_id then raise exception 'Radar başka hesaba ait.'; end if;
  if state.refresh_status in ('queued','running') and
      coalesce(state.refresh_deadline_at,coalesce(state.refresh_started_at,state.refresh_requested_at)+interval '15 minutes')<=now() then
    update hedge_radar_state set refresh_status='failed',refresh_completed_at=now(),refresh_retry_at=now(),
      refresh_error='Analiz zamanında tamamlanmadı. Yeniden başlatabilirsiniz.' where id=1 returning * into state;
  end if;
  if state.refresh_status in ('queued','running') then
    return jsonb_build_object('revision',state.refresh_version,'status',state.refresh_status,'dispatch',false,'retryAfterSeconds',0);
  end if;
  wait_seconds:=greatest(0,ceil(extract(epoch from state.refresh_retry_at-now()))::integer);
  if p_source='scheduled' then
    if state.updated_at>now()-interval '15 minutes' then
      return jsonb_build_object('revision',state.refresh_version,'status',state.refresh_status,'dispatch',false,'retryAfterSeconds',0);
    end if;
    if state.refresh_requested_at>now()-interval '5 minutes' then
      wait_seconds:=greatest(wait_seconds,ceil(extract(epoch from state.refresh_requested_at+interval '5 minutes'-now()))::integer);
    end if;
  end if;
  if wait_seconds>0 then return jsonb_build_object('revision',state.refresh_version,'status',state.refresh_status,
    'dispatch',false,'retryAfterSeconds',wait_seconds); end if;
  insert into hedge_radar_state(id,owner_user_id,refresh_status,refresh_version,refresh_requested_at,refresh_deadline_at,refresh_source)
    values(1,p_user_id,'queued',1,now(),now()+interval '15 minutes',p_source)
    on conflict(id) do update set refresh_status='queued',refresh_version=hedge_radar_state.refresh_version+1,
      refresh_requested_at=now(),refresh_started_at=null,refresh_completed_at=null,refresh_deadline_at=now()+interval '15 minutes',
      refresh_retry_at=null,refresh_run_id=null,refresh_run_url=null,refresh_error=null,refresh_source=p_source
    returning * into state;
  return jsonb_build_object('revision',state.refresh_version,'status','queued','dispatch',true,'retryAfterSeconds',0);
end $$;

create or replace function public.start_hedge_radar_run(p_user_id uuid,p_revision integer,p_run_id bigint,p_run_url text,p_source text default 'scheduled')
returns jsonb language plpgsql security definer set search_path=public as $$
declare state hedge_radar_state; reservation jsonb; revision integer:=p_revision;
begin
  perform pg_advisory_xact_lock(hashtextextended('hedge_radar',0));
  select * into state from hedge_radar_state where id=1 for update;
  if state.id is not null and state.owner_user_id<>p_user_id then raise exception 'Radar başka hesaba ait.'; end if;
  if p_run_id<=0 or p_run_id is null then raise exception 'Analiz iş kimliği eksik.'; end if;
  if revision is null then
    reservation:=reserve_hedge_radar_refresh(p_user_id,p_source);
    if not (reservation->>'dispatch')::boolean then return jsonb_build_object('started',false); end if;
    revision:=(reservation->>'revision')::integer;
    select * into state from hedge_radar_state where id=1 for update;
  end if;
  if state.refresh_version is distinct from revision or state.refresh_status not in ('queued','running')
    or (state.refresh_run_id is not null and state.refresh_run_id<>p_run_id) then return jsonb_build_object('started',false); end if;
  update hedge_radar_state set refresh_status='running',refresh_started_at=coalesce(refresh_started_at,now()),
    refresh_deadline_at=case when refresh_status='queued' then now()+interval '15 minutes' else refresh_deadline_at end,
    refresh_run_id=p_run_id,refresh_run_url=p_run_url where id=1;
  return jsonb_build_object('started',true,'revision',revision);
end $$;

create or replace function public.fail_hedge_radar_run(p_user_id uuid,p_revision integer,p_run_id bigint,p_error text)
returns boolean language plpgsql security definer set search_path=public as $$
declare changed boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('hedge_radar',0));
  update hedge_radar_state set refresh_status='failed',refresh_completed_at=now(),refresh_retry_at=now()+interval '30 seconds',
    refresh_error=left(p_error,350)
    where id=1 and owner_user_id=p_user_id and refresh_version=p_revision and refresh_status in ('queued','running')
    and (refresh_run_id=p_run_id or (refresh_run_id is null and p_run_id is null)) returning true into changed;
  return coalesce(changed,false);
end $$;

-- Retain the existing financial publication and notification rules, adding a
-- revision/run guard and completion metadata around them.
do $$ begin
  if to_regprocedure('public.publish_hedge_radar_snapshot(jsonb,integer)') is null then
    alter function public.publish_hedge_radar_state(jsonb,integer) rename to publish_hedge_radar_snapshot;
  end if;
end $$;
revoke all on function public.publish_hedge_radar_snapshot(jsonb,integer) from public,anon,authenticated,service_role;
create or replace function public.publish_hedge_radar_state(p_state jsonb,p_refresh_version integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare state hedge_radar_state; published boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('hedge_radar',0));
  select * into state from hedge_radar_state where id=1 for update;
  if state.owner_user_id::text is distinct from p_state->>'owner_user_id' then raise exception 'Radar sahibi değiştirilemez.'; end if;
  if state.refresh_version is distinct from p_refresh_version or state.refresh_status not in ('queued','running') then return false; end if;
  if state.refresh_run_id is not null and state.refresh_run_id::text is distinct from p_state->'diagnostics'->>'workflow_run_id' then return false; end if;
  published:=publish_hedge_radar_snapshot(p_state,p_refresh_version);
  if published then
    update hedge_radar_state set refresh_completed_at=now(),refresh_retry_at=now()+interval '5 minutes',refresh_error=null
      where id=1 and refresh_version=p_refresh_version;
  end if;
  return published;
end $$;

revoke all on function public.reserve_hedge_radar_refresh(uuid,text),public.start_hedge_radar_run(uuid,integer,bigint,text,text),
  public.fail_hedge_radar_run(uuid,integer,bigint,text),public.publish_hedge_radar_state(jsonb,integer) from public;
grant execute on function public.reserve_hedge_radar_refresh(uuid,text),public.start_hedge_radar_run(uuid,integer,bigint,text,text),
  public.fail_hedge_radar_run(uuid,integer,bigint,text),public.publish_hedge_radar_state(jsonb,integer) to service_role;
commit;

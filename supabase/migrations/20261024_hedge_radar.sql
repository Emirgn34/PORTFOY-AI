-- Run AFTER automation-schema.sql. Existing subscriptions and deliveries stay intact.
begin;
create table if not exists public.hedge_radar_state (
  id integer primary key default 1 check (id = 1),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz,
  market_regime text check (market_regime in ('SAFE','SUPPORT_TEST','TRAP_WARNING','HEDGE_TRIGGER','DEEP_VALUE_BUY')),
  previous_regime text,
  qqq_price double precision, qqq_sma50 double precision, qqq_atr double precision,
  qqq_weekly_ema20 double precision, qqq_weekly_ema50 double precision,
  soxx_price double precision, soxx_sma50 double precision,
  soxx_weekly_ema20 double precision, soxx_weekly_ema50 double precision,
  vix_level double precision, vix_change_pct double precision,
  portfolio_beta double precision, portfolio_value_usd double precision,
  recommended_action text,
  hedge_recipe jsonb not null default '{}', stock_radar jsonb not null default '[]',
  diagnostics jsonb not null default '{}',
  refresh_status text not null default 'idle' check (refresh_status in ('idle','queued','completed','failed')),
  refresh_version integer not null default 0,
  refresh_requested_at timestamptz, refresh_error text,
  pending_notification text, last_close_notified_session text
);
alter table public.hedge_radar_state enable row level security;
revoke all on public.hedge_radar_state from anon, authenticated;
grant select on public.hedge_radar_state to authenticated;
grant all on public.hedge_radar_state to service_role;
drop policy if exists hedge_radar_owner_read on public.hedge_radar_state;
create policy hedge_radar_owner_read on public.hedge_radar_state for select
  to authenticated using (owner_user_id = auth.uid());

-- One request counter in the same row, with a database-enforced cooldown.
create or replace function public.request_hedge_radar_refresh(p_user_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare state public.hedge_radar_state; revision integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('hedge_radar',0));
  select * into state from hedge_radar_state where id=1 for update;
  if state.id is not null and state.owner_user_id <> p_user_id then raise exception 'Radar başka hesaba ait.'; end if;
  if state.refresh_requested_at > now()-interval '5 minutes' then raise exception 'Yeni analiz için 5 dakika bekleyin.'; end if;
  insert into hedge_radar_state(id,owner_user_id,refresh_status,refresh_version,refresh_requested_at)
    values(1,p_user_id,'queued',1,now())
    on conflict(id) do update set refresh_status='queued',refresh_version=hedge_radar_state.refresh_version+1,
      refresh_requested_at=now(),refresh_error=null
    returning refresh_version into revision;
  return revision;
end $$;

create or replace function public.publish_hedge_radar_state(p_state jsonb, p_refresh_version integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare old public.hedge_radar_state; incoming public.hedge_radar_state; pending text;
begin
  perform pg_advisory_xact_lock(hashtextextended('hedge_radar',0));
  select * into incoming from jsonb_populate_record(null::public.hedge_radar_state,p_state);
  if incoming.owner_user_id is null or incoming.updated_at is null or incoming.market_regime is null
    or incoming.qqq_price is null or incoming.qqq_price <= 0 or incoming.portfolio_beta is null
    or jsonb_typeof(incoming.stock_radar) is distinct from 'array'
    then raise exception 'Radar verisi eksik.'; end if;
  select * into old from hedge_radar_state where id=1 for update;
  if old.id is not null and old.owner_user_id<>incoming.owner_user_id then raise exception 'Radar sahibi değiştirilemez.'; end if;
  if old.updated_at >= incoming.updated_at then return false; end if;
  pending := old.pending_notification;
  if coalesce((incoming.diagnostics->>'notifications_allowed')::boolean,false) and
    (old.market_regime is distinct from incoming.market_regime or
      (coalesce((incoming.diagnostics->>'closing_window')::boolean,false)
        and incoming.market_regime in ('HEDGE_TRIGGER','DEEP_VALUE_BUY')
        and old.last_close_notified_session is distinct from incoming.diagnostics->>'session_date')) then
    pending := 'hedge-'||md5(incoming.updated_at::text||incoming.market_regime);
  elsif old.market_regime is distinct from incoming.market_regime then
    pending := null;
  end if;
  insert into hedge_radar_state(id,owner_user_id,updated_at,market_regime,previous_regime,
    qqq_price,qqq_sma50,qqq_atr,qqq_weekly_ema20,qqq_weekly_ema50,
    soxx_price,soxx_sma50,soxx_weekly_ema20,soxx_weekly_ema50,vix_level,vix_change_pct,
    portfolio_beta,portfolio_value_usd,recommended_action,hedge_recipe,stock_radar,diagnostics,
    refresh_status,pending_notification)
  values(1,incoming.owner_user_id,incoming.updated_at,incoming.market_regime,old.market_regime,
    incoming.qqq_price,incoming.qqq_sma50,incoming.qqq_atr,incoming.qqq_weekly_ema20,incoming.qqq_weekly_ema50,
    incoming.soxx_price,incoming.soxx_sma50,incoming.soxx_weekly_ema20,incoming.soxx_weekly_ema50,incoming.vix_level,incoming.vix_change_pct,
    incoming.portfolio_beta,incoming.portfolio_value_usd,incoming.recommended_action,incoming.hedge_recipe,
    incoming.stock_radar,incoming.diagnostics,'completed',pending)
  on conflict(id) do update set updated_at=excluded.updated_at, market_regime=excluded.market_regime,
    previous_regime=case when hedge_radar_state.market_regime is distinct from excluded.market_regime
      then hedge_radar_state.market_regime else hedge_radar_state.previous_regime end,
    qqq_price=excluded.qqq_price,qqq_sma50=excluded.qqq_sma50,qqq_atr=excluded.qqq_atr,
    qqq_weekly_ema20=excluded.qqq_weekly_ema20,qqq_weekly_ema50=excluded.qqq_weekly_ema50,
    soxx_price=excluded.soxx_price,soxx_sma50=excluded.soxx_sma50,
    soxx_weekly_ema20=excluded.soxx_weekly_ema20,soxx_weekly_ema50=excluded.soxx_weekly_ema50,
    vix_level=excluded.vix_level,vix_change_pct=excluded.vix_change_pct,
    portfolio_beta=excluded.portfolio_beta,portfolio_value_usd=excluded.portfolio_value_usd,
    recommended_action=excluded.recommended_action,hedge_recipe=excluded.hedge_recipe,
    stock_radar=excluded.stock_radar,diagnostics=excluded.diagnostics,pending_notification=excluded.pending_notification,
    refresh_status=case when hedge_radar_state.refresh_version<=p_refresh_version then 'completed' else hedge_radar_state.refresh_status end,
    refresh_error=null;
  return true;
end $$;

-- The Python engine requests delivery, but only the server reads the saved
-- action. A request body cannot inject arbitrary phone notifications.
alter table public.notification_events drop constraint if exists notification_events_topic_check;
alter table public.notification_events add constraint notification_events_topic_check
  check(topic in ('catalyst','source-portfolios','hedge-radar'));
create or replace function public.queue_hedge_radar_notification()
returns text language plpgsql security definer set search_path=public as $$
declare state public.hedge_radar_state; event_key text;
begin
  select * into state from hedge_radar_state where id=1 for update;
  if state.pending_notification is null or state.updated_at < now()-interval '45 minutes'
    or not coalesce((state.diagnostics->>'notifications_allowed')::boolean,false) then return null; end if;
  event_key := state.pending_notification;
  insert into notification_events(id,topic,title,body,url,data,published_at,detected_at,expires_at)
  values(event_key,'hedge-radar','Portföy Kalkanı · '||state.market_regime,state.recommended_action,
    '/portfolio#hedge-shield',jsonb_build_object('userId',state.owner_user_id,'regime',state.market_regime),
    state.updated_at,now(),now()+interval '45 minutes') on conflict(id) do nothing;
  update hedge_radar_state set pending_notification=null,
    last_close_notified_session=case when coalesce((diagnostics->>'closing_window')::boolean,false)
      and market_regime in ('HEDGE_TRIGGER','DEEP_VALUE_BUY') then diagnostics->>'session_date'
      else last_close_notified_session end where id=1;
  -- Bound storage: only already-expired radar events; cascades delivery history.
  delete from notification_events where topic='hedge-radar' and expires_at < now()-interval '7 days';
  return event_key;
end $$;
revoke all on function public.request_hedge_radar_refresh(uuid),public.publish_hedge_radar_state(jsonb,integer),
  public.queue_hedge_radar_notification() from public;
grant execute on function public.request_hedge_radar_refresh(uuid),public.publish_hedge_radar_state(jsonb,integer),
  public.queue_hedge_radar_notification() to service_role;
-- push_subscriptions already stores endpoint + subscription.keys + user_id.
-- Reusing it preserves existing iOS/Android subscriptions and ownership checks.
commit;

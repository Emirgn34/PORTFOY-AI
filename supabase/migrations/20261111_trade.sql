-- Apply AFTER schema.sql, automation-schema.sql and existing migrations.
-- Service-only state: JWT owners read/update their preference through the API.
begin;
create table if not exists public.trade_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.trade_signals (
  symbol text primary key check(symbol ~ '^[A-Z][A-Z0-9.\-]{0,14}$'),
  data jsonb not null,
  quote_time timestamptz not null,
  realtime boolean not null default false,
  source text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.trade_context (
  symbol text primary key,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table if not exists public.trade_notification_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  notified_at timestamptz not null,
  primary key(user_id,symbol)
);
alter table public.trade_preferences enable row level security;
alter table public.trade_signals enable row level security;
alter table public.trade_context enable row level security;
alter table public.trade_notification_state enable row level security;
revoke all on public.trade_preferences,public.trade_signals,public.trade_context,public.trade_notification_state from anon,authenticated;
grant all on public.trade_preferences,public.trade_signals,public.trade_context,public.trade_notification_state to service_role;
alter table public.notification_events drop constraint if exists notification_events_topic_check;
alter table public.notification_events add constraint notification_events_topic_check check(topic in ('catalyst','source-portfolios','hedge-radar','trade'));

create or replace function public.publish_trade_signal(p_signal jsonb,p_quote_time timestamptz,p_realtime boolean,p_source text)
returns boolean language plpgsql security definer set search_path=public as $$
declare ticker text; signal_key text; recipient record; expiration timestamptz; previous_time timestamptz;
begin
  ticker:=p_signal->>'symbol';
  if ticker is null or ticker !~ '^[A-Z][A-Z0-9.\-]{0,14}$' or coalesce(p_signal->>'status','') not in ('ready','watch','blocked')
    or p_quote_time is null or p_source is null or length(p_source)=0 or length(p_source)>100 or p_quote_time>now()+interval '2 seconds' then
    raise exception 'Trade verisi geçersiz.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('trade:'||ticker,0));
  select quote_time into previous_time from trade_signals where symbol=ticker;
  if previous_time is not null and previous_time>p_quote_time then return false; end if;
  insert into trade_signals(symbol,data,quote_time,realtime,source,updated_at) values(ticker,p_signal,p_quote_time,p_realtime,p_source,now())
    on conflict(symbol) do update set data=excluded.data,quote_time=excluded.quote_time,realtime=excluded.realtime,source=excluded.source,updated_at=excluded.updated_at;
  -- ÇAPRAZ REFERANS: '15 seconds' = TRADE_QUOTE_MAX_AGE_MS (server/tradeData.js).
  -- Oradaki eşik değişirse bu fonksiyon da yeni bir migration ile güncellenmeli.
  if p_signal->>'status'<>'ready' or not p_realtime or p_quote_time<now()-interval '15 seconds' then return true; end if;
  expiration:=least((p_signal->>'expiresAt')::timestamptz,p_quote_time+interval '15 seconds',now()+interval '15 seconds');
  if expiration is null or expiration<=now() then return true; end if;
  for recipient in select p.user_id from trade_preferences p where p.enabled
    and exists(select 1 from push_subscriptions s where s.user_id=p.user_id and 'trade'=any(s.topics))
    and not exists(select 1 from trade_notification_state n where n.user_id=p.user_id and n.symbol=ticker and n.notified_at>now()-interval '15 minutes')
  loop
    signal_key:='trade-'||md5(ticker||':'||recipient.user_id::text||':'||p_quote_time::text);
    insert into notification_events(id,topic,title,body,url,data,published_at,detected_at,expires_at)
      values(signal_key,'trade',ticker||' · Trade sinyali',
        left(coalesce(p_signal->'reasons'->>0,'Güncel teknik kurulum oluştu.')||' Hedef ve stop koşullarını Trade sayfasında kontrol edin.',250),
        '/trade?symbol='||ticker,jsonb_build_object('userId',recipient.user_id,'symbol',ticker,'signalId',p_signal->>'id','expiresAt',expiration),
        p_quote_time,now(),expiration) on conflict(id) do nothing;
    insert into trade_notification_state(user_id,symbol,notified_at) values(recipient.user_id,ticker,now())
      on conflict(user_id,symbol) do update set notified_at=excluded.notified_at;
  end loop;
  delete from notification_events where topic='trade' and expires_at<now()-interval '1 day';
  return true;
end $$;

-- Recheck immediately before delivery: opting out, a halt, or a newer blocked
-- snapshot cancels a queued signal. Subscription user_id is server controlled.
create or replace function public.trade_delivery_allowed(p_event_id text,p_user_id uuid)
returns boolean language sql security definer set search_path=public stable as $$
  select exists(select 1 from notification_events e
    join trade_preferences p on p.user_id=p_user_id and p.enabled
    join trade_signals s on s.symbol=e.data->>'symbol'
    where e.id=p_event_id and e.topic='trade' and e.data->>'userId'=p_user_id::text
      and e.expires_at>now() and e.detected_at<=now()
      and s.realtime and s.data->>'status'='ready'
      and s.quote_time>now()-interval '15 seconds'
      and (s.data->>'expiresAt')::timestamptz>now());
$$;
revoke all on function public.publish_trade_signal(jsonb,timestamptz,boolean,text),public.trade_delivery_allowed(text,uuid) from public;
grant execute on function public.publish_trade_signal(jsonb,timestamptz,boolean,text),public.trade_delivery_allowed(text,uuid) to service_role;

-- Trade events expire in seconds. Preserve existing retry behavior for news;
-- trade gets bounded 1/2/4-second retries and a five-second crashed-send lease.
create or replace function public.claim_push_delivery(p_event_id text,p_subscription_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare claimed boolean; trade_event boolean;
begin
  select topic='trade' into trade_event from notification_events where id=p_event_id;
  if trade_event and not exists(select 1 from push_subscriptions s where s.id=p_subscription_id
    and 'trade'=any(s.topics) and public.trade_delivery_allowed(p_event_id,s.user_id)) then return false; end if;
  insert into push_deliveries(event_id,subscription_id) values(p_event_id,p_subscription_id) on conflict do nothing;
  update push_deliveries set status='sending',locked_at=now(),attempts=attempts+1
    where event_id=p_event_id and subscription_id=p_subscription_id and attempts<case when trade_event then 5 else 8 end
    and ((status='pending' and (locked_at is null or locked_at<=now()-
      case when trade_event then least(interval '4 seconds',interval '1 second'*power(2,greatest(0,attempts-1)))
        else least(interval '2 minutes',interval '15 seconds'*power(2,greatest(0,attempts-1))) end))
      or (status='sending' and locked_at<now()-case when trade_event then interval '5 seconds' else interval '2 minutes' end))
    returning true into claimed;
  return coalesce(claimed,false);
end $$;
revoke all on function public.claim_push_delivery(text,uuid) from public;
grant execute on function public.claim_push_delivery(text,uuid) to service_role;
commit;

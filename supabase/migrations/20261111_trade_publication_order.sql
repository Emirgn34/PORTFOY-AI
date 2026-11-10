-- Apply after 20261111_trade.sql. Keeps a late snapshot from undoing a halt.
-- No existing rows, subscriptions or user preferences are deleted.
begin;
create or replace function public.publish_trade_signal(p_signal jsonb,p_quote_time timestamptz,p_realtime boolean,p_source text)
returns boolean language plpgsql security definer set search_path=public as $$
declare ticker text; signal_key text; recipient record; expiration timestamptz;
  previous public.trade_signals%rowtype; received_at timestamptz; previous_received_at timestamptz;
  incoming_rank integer; previous_rank integer;
begin
  ticker:=p_signal->>'symbol';
  if ticker is null or ticker !~ '^[A-Z][A-Z0-9.\-]{0,14}$' or coalesce(p_signal->>'status','') not in ('ready','watch','blocked')
    or p_quote_time is null or p_source is null or length(p_source)=0 or length(p_source)>100 or p_quote_time>now()+interval '2 seconds' then
    raise exception 'Trade verisi geçersiz.';
  end if;
  received_at:=coalesce(nullif(p_signal#>>'{dataQuality,receivedAt}','')::timestamptz,p_quote_time);
  if received_at>now()+interval '2 seconds' then raise exception 'Trade alım zamanı geçersiz.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('trade:'||ticker,0));
  select * into previous from trade_signals where symbol=ticker;
  if found then
    if previous.quote_time>p_quote_time then return false; end if;
    -- A delayed research task must not erase a currently live licensed quote.
    if previous.realtime and not p_realtime and previous.quote_time>now()-interval '15 seconds' then return false; end if;
    if previous.quote_time=p_quote_time then
      previous_received_at:=coalesce(nullif(previous.data#>>'{dataQuality,receivedAt}','')::timestamptz,previous.quote_time);
      incoming_rank:=case p_signal->>'status' when 'blocked' then 2 when 'watch' then 1 else 0 end;
      previous_rank:=case previous.data->>'status' when 'blocked' then 2 when 'watch' then 1 else 0 end;
      -- A stricter gate may revoke an equal-time quote immediately. An upgrade
      -- requires a NEW market timestamp, including after a halt/resumption.
      if incoming_rank<previous_rank then return false; end if;
      if received_at<previous_received_at and incoming_rank<=previous_rank then return false; end if;
    end if;
  end if;
  insert into trade_signals(symbol,data,quote_time,realtime,source,updated_at) values(ticker,p_signal,p_quote_time,p_realtime,p_source,now())
    on conflict(symbol) do update set data=excluded.data,quote_time=excluded.quote_time,realtime=excluded.realtime,source=excluded.source,updated_at=excluded.updated_at;
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
revoke all on function public.publish_trade_signal(jsonb,timestamptz,boolean,text) from public;
grant execute on function public.publish_trade_signal(jsonb,timestamptz,boolean,text) to service_role;

-- A known feed outage revokes queued alerts immediately, even while the last
-- quote is still within its fifteen-second age limit.
create or replace function public.trade_delivery_allowed(p_event_id text,p_user_id uuid)
returns boolean language sql security definer set search_path=public stable as $$
  select exists(select 1 from notification_events e
    join trade_preferences p on p.user_id=p_user_id and p.enabled
    join trade_signals s on s.symbol=e.data->>'symbol'
    join monitor_status m on m.id='trade'
    where e.id=p_event_id and e.topic='trade' and e.data->>'userId'=p_user_id::text
      and e.expires_at>now() and e.detected_at<=now()
      and s.realtime and s.data->>'status'='ready'
      and s.quote_time>now()-interval '15 seconds'
      and (s.data->>'expiresAt')::timestamptz>now()
      and m.data->>'ok'='true' and coalesce(m.data->>'running','true')='true'
      and m.updated_at>now()-interval '30 seconds' and m.updated_at<=now()+interval '2 seconds');
$$;
revoke all on function public.trade_delivery_allowed(text,uuid) from public;
grant execute on function public.trade_delivery_allowed(text,uuid) to service_role;
commit;

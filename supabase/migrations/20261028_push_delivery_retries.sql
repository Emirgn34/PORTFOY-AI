-- Apply before deploying the notification delivery update. No existing events,
-- subscriptions or successful deliveries are removed or requeued.
create or replace function public.claim_push_delivery(p_event_id text,p_subscription_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare claimed boolean;
begin
  insert into push_deliveries(event_id,subscription_id) values(p_event_id,p_subscription_id) on conflict do nothing;
  update push_deliveries set status='sending',locked_at=now(),attempts=attempts+1
    where event_id=p_event_id and subscription_id=p_subscription_id and attempts<8
    and ((status='pending' and (locked_at is null or
      locked_at <= now()-least(interval '2 minutes', interval '15 seconds' * power(2, greatest(0, attempts-1)))))
      or (status='sending' and locked_at < now()-interval '2 minutes')) returning true into claimed;
  return coalesce(claimed,false);
end $$;

revoke all on function public.claim_push_delivery(text,uuid) from public;
grant execute on function public.claim_push_delivery(text,uuid) to service_role;

create index if not exists notification_events_expiry on public.notification_events(expires_at);

-- Run before deploying the faster scanner. This does not enable a cron job.
insert into public.monitor_status(id,updated_at,data)
values('news-scan-lock',now()-interval '1 day','{}') on conflict(id) do nothing;

create or replace function public.claim_news_scan()
returns uuid language plpgsql security definer set search_path=public as $$
declare state monitor_status; token uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended('free-news-scan',0));
  select * into state from monitor_status where id='news-scan-lock' for update;
  if (state.data->>'lockedUntil')::timestamptz > now()
    or state.updated_at > now()-interval '45 seconds' then return null; end if;
  insert into monitor_status(id,updated_at,data)
    values('news-scan-lock',now(),jsonb_build_object('token',token,'lockedUntil',now()+interval '90 seconds'))
    on conflict(id) do update set updated_at=excluded.updated_at,data=excluded.data;
  return token;
end $$;

create or replace function public.release_news_scan(p_token uuid)
returns void language sql security definer set search_path=public as $$
  update monitor_status set data=jsonb_set(data,'{lockedUntil}',to_jsonb(now()))
    where id='news-scan-lock' and data->>'token'=p_token::text;
$$;

revoke all on function public.claim_news_scan(),public.release_news_scan(uuid) from public;
grant execute on function public.claim_news_scan(),public.release_news_scan(uuid) to service_role;

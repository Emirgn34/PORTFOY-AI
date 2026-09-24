-- Manuel sepetler, kaynak takibi ve Web Push. Mevcut aylık tabloları değiştirmez.
create table if not exists public.portfolio_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  preferences jsonb not null default '{}',
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create unique index if not exists portfolio_jobs_one_pending on public.portfolio_jobs(user_id) where status in ('queued','running');
create table if not exists public.value_portfolio_versions (
  id uuid primary key references public.portfolio_jobs(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  portfolios jsonb not null,
  preferences jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.source_portfolio_runs (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.monitor_status (
  id text primary key,
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'
);
create table if not exists public.notification_events (
  id text primary key,
  topic text not null check (topic in ('catalyst','source-portfolios')),
  title text not null,
  body text not null,
  url text not null,
  data jsonb not null default '{}',
  published_at timestamptz not null,
  detected_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists notification_events_recent on public.notification_events(published_at desc);
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  topics text[] not null default array['catalyst','source-portfolios'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.push_deliveries (
  event_id text not null references public.notification_events(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending',
  attempts integer not null default 0,
  locked_at timestamptz,
  delivered_at timestamptz,
  primary key (event_id,subscription_id)
);

create or replace function public.request_value_portfolios(p_user_id uuid, p_preferences jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare job_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select id into job_id from portfolio_jobs where user_id=p_user_id and status in ('queued','running');
  if job_id is not null then return job_id; end if;
  if exists(select 1 from portfolio_jobs where user_id=p_user_id and created_at > now()-interval '5 minutes') then
    raise exception 'Yeni bir analiz için 5 dakika bekleyin.';
  end if;
  insert into portfolio_jobs(user_id,preferences) values(p_user_id,p_preferences) returning id into job_id;
  return job_id;
end $$;
create or replace function public.claim_value_portfolio_job()
returns setof public.portfolio_jobs language plpgsql security definer set search_path = public as $$
begin
  update portfolio_jobs set status='failed', error='Analiz zaman aşımına uğradı; yeniden başlatabilirsiniz.',completed_at=now()
    where status='running' and started_at < now()-interval '30 minutes';
  return query update portfolio_jobs set status='running',started_at=now()
    where id=(select id from portfolio_jobs where status='queued' order by created_at for update skip locked limit 1)
    returning *;
end $$;
create or replace function public.finish_value_portfolio_job(p_id uuid,p_portfolios jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare job portfolio_jobs;
begin
  select * into job from portfolio_jobs where id=p_id and status='running' for update;
  if job.id is null then raise exception 'Analiz artık etkin değil.'; end if;
  if jsonb_array_length(p_portfolios)<>4 then raise exception 'Dört sepet gerekli.'; end if;
  insert into value_portfolio_versions(id,user_id,portfolios,preferences) values(job.id,job.user_id,p_portfolios,job.preferences);
  update portfolio_jobs set status='completed',completed_at=now() where id=p_id;
end $$;
create or replace function public.claim_push_delivery(p_event_id text,p_subscription_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare claimed boolean;
begin
  insert into push_deliveries(event_id,subscription_id) values(p_event_id,p_subscription_id) on conflict do nothing;
  update push_deliveries set status='sending',locked_at=now(),attempts=attempts+1
    where event_id=p_event_id and subscription_id=p_subscription_id and attempts<4
    and (status='pending' or (status='sending' and locked_at < now()-interval '2 minutes')) returning true into claimed;
  return coalesce(claimed,false);
end $$;

create or replace function public.publish_source_portfolios(p_fingerprint text,p_data jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare previous_fingerprint text;
begin
  perform pg_advisory_xact_lock(hashtextextended('source_portfolio_publication',0));
  if exists(select 1 from source_portfolio_runs where fingerprint=p_fingerprint) then return; end if;
  if coalesce(jsonb_array_length(p_data->'portfolios'),0)<>4 or coalesce(p_data->>'selectionFingerprint','')='' then
    raise exception 'Dört kaynak sepeti ve seçim kimliği gerekli.';
  end if;
  select data->>'selectionFingerprint' into previous_fingerprint from source_portfolio_runs order by created_at desc limit 1;
  insert into source_portfolio_runs(fingerprint,data) values(p_fingerprint,p_data);
  if previous_fingerprint is not null and previous_fingerprint<>p_data->>'selectionFingerprint' then
    insert into notification_events(id,topic,title,body,url,data,published_at,detected_at,expires_at)
      values('source-'||p_fingerprint,'source-portfolios','Yatırımcı portföyleri yenilendi',
      'İzlenen kaynaklar ve güncel analizlerle dört sepetin dağılımı değişti.','/source-portfolios',
      jsonb_build_object('selectionFingerprint',p_data->>'selectionFingerprint'),now(),now(),now()+interval '6 hours');
  end if;
end $$;

alter table public.portfolio_jobs enable row level security;
alter table public.value_portfolio_versions enable row level security;
alter table public.source_portfolio_runs enable row level security;
alter table public.monitor_status enable row level security;
alter table public.notification_events enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries enable row level security;
revoke all on public.portfolio_jobs,public.value_portfolio_versions,public.source_portfolio_runs,public.monitor_status,public.notification_events,public.push_subscriptions,public.push_deliveries from anon,authenticated;
grant all on public.portfolio_jobs,public.value_portfolio_versions,public.source_portfolio_runs,public.monitor_status,public.notification_events,public.push_subscriptions,public.push_deliveries to service_role;
revoke all on function public.request_value_portfolios(uuid,jsonb),public.claim_value_portfolio_job(),public.finish_value_portfolio_job(uuid,jsonb),public.claim_push_delivery(text,uuid) from public;
grant execute on function public.request_value_portfolios(uuid,jsonb),public.claim_value_portfolio_job(),public.finish_value_portfolio_job(uuid,jsonb),public.claim_push_delivery(text,uuid) to service_role;
revoke all on function public.publish_source_portfolios(text,jsonb) from public;
grant execute on function public.publish_source_portfolios(text,jsonb) to service_role;

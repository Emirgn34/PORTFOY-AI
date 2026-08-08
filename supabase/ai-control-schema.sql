-- Claude maliyet kontrolü: kalıcı karar cache'i, günlük kullanım ve kullanıcı kotası.
-- Supabase SQL Editor'da bir kez çalıştırın.

create table if not exists ai_decision_cache (
  cache_key text primary key,
  symbol text not null,
  model text not null,
  prompt_version text not null,
  evidence_signature text not null,
  result jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_decision_cache_expiry_idx on ai_decision_cache (expires_at);

create table if not exists ai_daily_usage (
  usage_date date not null default current_date,
  flow text not null,
  calls integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_creation_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  estimated_cost_usd numeric(14,8) not null default 0,
  metadata jsonb,
  updated_at timestamptz not null default now(),
  primary key (usage_date, flow)
);

create or replace function record_ai_usage(
  p_flow text,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_cache_creation_tokens bigint,
  p_cache_read_tokens bigint,
  p_estimated_cost_usd numeric,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into ai_daily_usage (
    usage_date, flow, calls, input_tokens, output_tokens,
    cache_creation_tokens, cache_read_tokens, estimated_cost_usd, metadata
  ) values (
    current_date, p_flow, 1, p_input_tokens, p_output_tokens,
    p_cache_creation_tokens, p_cache_read_tokens, p_estimated_cost_usd, p_metadata
  )
  on conflict (usage_date, flow) do update set
    calls = ai_daily_usage.calls + 1,
    input_tokens = ai_daily_usage.input_tokens + excluded.input_tokens,
    output_tokens = ai_daily_usage.output_tokens + excluded.output_tokens,
    cache_creation_tokens = ai_daily_usage.cache_creation_tokens + excluded.cache_creation_tokens,
    cache_read_tokens = ai_daily_usage.cache_read_tokens + excluded.cache_read_tokens,
    estimated_cost_usd = ai_daily_usage.estimated_cost_usd + excluded.estimated_cost_usd,
    metadata = excluded.metadata,
    updated_at = now();
end;
$$;

create table if not exists portfolio_ai_quotas (
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_date date not null default current_date,
  calls integer not null default 0,
  last_called_at timestamptz,
  primary key (user_id, usage_date)
);

create or replace function consume_portfolio_ai_quota(
  p_user_id uuid,
  p_daily_limit integer default 5,
  p_cooldown_seconds integer default 300
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted boolean := false;
begin
  insert into portfolio_ai_quotas (user_id, usage_date, calls, last_called_at)
  values (p_user_id, current_date, 1, now())
  on conflict (user_id, usage_date) do update set
    calls = portfolio_ai_quotas.calls + 1,
    last_called_at = now()
  where portfolio_ai_quotas.calls < greatest(0, p_daily_limit)
    and (
      portfolio_ai_quotas.last_called_at is null
      or portfolio_ai_quotas.last_called_at <= now() - make_interval(secs => greatest(0, p_cooldown_seconds))
    )
  returning true into accepted;

  return coalesce(accepted, false);
end;
$$;

alter table ai_decision_cache enable row level security;
alter table ai_daily_usage enable row level security;
alter table portfolio_ai_quotas enable row level security;

revoke all on ai_decision_cache, ai_daily_usage, portfolio_ai_quotas from anon, authenticated;
grant all on ai_decision_cache, ai_daily_usage, portfolio_ai_quotas to service_role;
revoke all on function record_ai_usage(text,bigint,bigint,bigint,bigint,numeric,jsonb) from public;
revoke all on function consume_portfolio_ai_quota(uuid,integer,integer) from public;
grant execute on function record_ai_usage(text,bigint,bigint,bigint,bigint,numeric,jsonb) to service_role;
grant execute on function consume_portfolio_ai_quota(uuid,integer,integer) to service_role;

-- Süresi dolan kararlar periyodik olarak temizlenebilir:
-- delete from ai_decision_cache where expires_at < now();

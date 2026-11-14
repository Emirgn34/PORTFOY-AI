-- Forward-only model trade journal. Apply after the existing Trade migrations.
begin;
create table if not exists public.trade_history (
  id text primary key check(length(id) between 1 and 160),
  symbol text not null check(symbol ~ '^[A-Z][A-Z0-9.\-]{0,14}$'),
  mode text not null check(mode in ('research','live')),
  status text not null check(status in ('pending','active','target','stop','expired','ambiguous','unresolved')),
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check(revision>0),
  data jsonb not null check(jsonb_typeof(data)='object' and jsonb_typeof(data->'targets')='array')
);
create index if not exists trade_history_created_idx on public.trade_history(created_at desc,id);
create index if not exists trade_history_pending_idx on public.trade_history(symbol,mode) where status in ('pending','active');
alter table public.trade_history enable row level security;
revoke all on public.trade_history from public,anon,authenticated;
grant all on public.trade_history to service_role;

-- A replay may settle a model, never revise its original prices or policy.
create or replace function public.trade_history_plan_identity(p_record jsonb)
returns jsonb language sql immutable set search_path=public as $$
  select jsonb_build_object(
    'plan', jsonb_build_array(p_record->'id',p_record->'symbol',p_record->'name',p_record->'market',p_record->'currency',
      p_record->'mode',p_record->'strategyId',p_record->'strategyName',p_record->'direction',p_record->'createdAt',
      p_record->'trackingStartsAt',p_record->'trackingEndsAt',p_record->'entryDeadlineAt',p_record->'entry',
      p_record->'entryLow',p_record->'entryHigh',p_record->'stopLoss',p_record->'costBps',p_record->'costAssumed',
      p_record->'source',p_record->'sessionKey',p_record->'trackingPolicy',p_record->'executionModel',p_record->'entryModel'),
    'targets',(select coalesce(jsonb_agg(jsonb_build_array(t->'id',t->'label',t->'targetPrice') order by n),'[]'::jsonb)
      from jsonb_array_elements(p_record->'targets') with ordinality as items(t,n)));
$$;
revoke all on function public.trade_history_plan_identity(jsonb) from public;
grant execute on function public.trade_history_plan_identity(jsonb) to service_role;

create or replace function public.save_trade_history(p_record jsonb,p_expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare previous public.trade_history%rowtype; new_revision integer;
begin
  if p_record->>'id' is null or p_record->>'symbol' is null
    or coalesce(p_record->>'mode','') not in ('research','live')
    or coalesce(p_record->>'status','') not in ('pending','active','target','stop','expired','ambiguous','unresolved')
    or jsonb_typeof(p_record->'targets') is distinct from 'array'
    or jsonb_array_length(p_record->'targets')<1 then
    raise exception 'Geçmiş trade kaydı geçersiz.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('trade-history:'||(p_record->>'id'),0));
  select * into previous from trade_history where id=p_record->>'id' for update;
  if previous.id is null then
    if p_expected_revision is not null then return jsonb_build_object('saved',false,'revision',null); end if;
    insert into trade_history(id,symbol,mode,status,created_at,data)
      values(p_record->>'id',p_record->>'symbol',p_record->>'mode',p_record->>'status',(p_record->>'createdAt')::timestamptz,p_record);
    return jsonb_build_object('saved',true,'revision',1);
  end if;
  if p_expected_revision is null or previous.revision<>p_expected_revision then
    return jsonb_build_object('saved',false,'revision',previous.revision);
  end if;
  if public.trade_history_plan_identity(previous.data) is distinct from public.trade_history_plan_identity(p_record) then
    raise exception 'Kaydedilmiş trade planı değiştirilemez.';
  end if;
  if previous.status not in ('pending','active') and previous.data is distinct from p_record then
    raise exception 'Tamamlanan trade sonucu değiştirilemez.';
  end if;
  if (previous.data->>'enteredAt' is not null and previous.data->'enteredAt' is distinct from p_record->'enteredAt')
    or (previous.status='active' and p_record->>'status'='pending')
    or exists(select 1 from jsonb_array_elements(previous.data->'targets') with ordinality as settled(t,n)
      where t->>'status'<>'pending' and t is distinct from p_record->'targets'->(n::integer-1)) then
    raise exception 'Gerçekleşmiş model girişi veya hedef sonucu değiştirilemez.';
  end if;
  if (previous.data->>'lastCheckedAt')::timestamptz > (p_record->>'lastCheckedAt')::timestamptz
    or (previous.data->>'lastBarAt')::timestamptz > (p_record->>'lastBarAt')::timestamptz then
    return jsonb_build_object('saved',false,'revision',previous.revision);
  end if;
  new_revision:=previous.revision+1;
  update trade_history set data=p_record,status=p_record->>'status',updated_at=now(),revision=new_revision where id=previous.id;
  return jsonb_build_object('saved',true,'revision',new_revision);
end $$;
revoke all on function public.save_trade_history(jsonb,integer) from public;
grant execute on function public.save_trade_history(jsonb,integer) to service_role;

-- Aggregate the entire filtered set in PostgreSQL; page length never changes
-- success rates. Only the primary target counts as one model trade.
create or replace function public.read_trade_history(
  p_since timestamptz default null,p_symbol text default null,p_strategy text default null,
  p_mode text default null,p_status text default null,p_page integer default 1,p_page_size integer default 20)
returns jsonb language sql stable security definer set search_path=public as $$
  with filtered as (
    select * from trade_history h where (p_since is null or h.created_at>=p_since)
      and (p_symbol is null or h.symbol=p_symbol) and (p_strategy is null or h.data->>'strategyId'=p_strategy)
      and (p_mode is null or h.mode=p_mode) and (p_status is null or h.status=p_status)
  ), totals as (
    select count(*) as total,
      count(*) filter(where status='pending') as pending,
      count(*) filter(where status='active') as active,
      count(*) filter(where status not in ('pending','active')) as completed,
      count(*) filter(where data->'targets'->0->>'status' in ('target','stop')) as resolved,
      count(*) filter(where data->'targets'->0->>'status'='target') as target_count,
      count(*) filter(where data->'targets'->0->>'status'='stop') as stop_count,
      count(*) filter(where status='expired') as expired_count,
      count(*) filter(where status='ambiguous') as ambiguous_count,
      count(*) filter(where status='unresolved') as unresolved_count,
      count(*) filter(where jsonb_typeof(data->'targets'->0->'netReturnPct')='number'
        and (data->'targets'->0->>'status' in ('target','stop') or (data->'targets'->0->>'status'='expired' and data->>'enteredAt' is not null))) as settled_count,
      avg((data->'targets'->0->>'netReturnPct')::numeric) filter(where data->'targets'->0->>'status' in ('target','stop')
        or (data->'targets'->0->>'status'='expired' and data->>'enteredAt' is not null)) as mean_return,
      max((data->>'lastCheckedAt')::timestamptz) as checked_at
    from filtered
  ), target_stats as (
    select data->>'strategyId' as strategy_id,t->>'id' as id,t->>'label' as label,count(*) as total,
      count(*) filter(where t->>'status' in ('target','stop')) as resolved,
      count(*) filter(where t->>'status'='target') as target_count,
      count(*) filter(where t->>'status'='stop') as stop_count,
      count(*) filter(where jsonb_typeof(t->'netReturnPct')='number'
        and (t->>'status' in ('target','stop') or (t->>'status'='expired' and data->>'enteredAt' is not null))) as settled_count,
      avg((t->>'netReturnPct')::numeric) filter(where t->>'status' in ('target','stop')
        or (t->>'status'='expired' and data->>'enteredAt' is not null)) as mean_return
    from filtered cross join lateral jsonb_array_elements(data->'targets') t group by data->>'strategyId',t->>'id',t->>'label'
  ), page_rows as (
    select data from filtered order by created_at desc,id asc
      limit greatest(1,least(100,p_page_size)) offset (greatest(1,p_page)-1)*greatest(1,least(100,p_page_size))
  )
  select jsonb_build_object('items',(select coalesce(jsonb_agg(data),'[]'::jsonb) from page_rows),
    'summary',jsonb_build_object('total',total,'pending',pending,'active',active,'completed',completed,'resolved',resolved,'settledCount',settled_count,
      'targetCount',target_count,'stopCount',stop_count,'expiredCount',expired_count,'ambiguousCount',ambiguous_count,
      'unresolvedCount',unresolved_count,'winRate',round(100.0*target_count/nullif(resolved,0),2),
      'targetRate',round(100.0*target_count/nullif(resolved,0),2),'stopRate',round(100.0*stop_count/nullif(resolved,0),2),
      'averageNetReturnPct',round(mean_return,4),
      'byTarget',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'strategyId',strategy_id,'label',label,'total',total,'resolved',resolved,'settledCount',settled_count,
        'targetCount',target_count,'stopCount',stop_count,'winRate',round(100.0*target_count/nullif(resolved,0),2),
        'averageNetReturnPct',round(mean_return,4)) order by strategy_id,id,label),'[]'::jsonb) from target_stats)),
    'pagination',jsonb_build_object('page',greatest(1,p_page),'pageSize',greatest(1,least(100,p_page_size)),
      'total',total,'hasMore',greatest(1,p_page)*greatest(1,least(100,p_page_size))<total),
    'tracking',jsonb_build_object('lastCheckedAt',checked_at,'pendingCount',pending+active),
    'installationRequired',false) from totals;
$$;
revoke all on function public.read_trade_history(timestamptz,text,text,text,text,integer,integer) from public;
grant execute on function public.read_trade_history(timestamptz,text,text,text,text,integer,integer) to service_role;
commit;

-- PortföyAI bulut veri şeması
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run

-- Uygulamanın izlediği semboller (Yahoo formatında: THYAO.IS, AAPL...)
create table if not exists tracked_symbols (
  id bigint generated always as identity primary key,
  symbol text not null,
  -- NULL sahibi yalnız service_role tarafından yazılan ortak/sistem sembolüdür.
  -- Kullanıcı eklerinde auth.uid() otomatik atanır.
  user_id uuid default auth.uid(),
  added_at timestamptz not null default now()
);

-- Eski kurulumlarda bütün kayıtlar güvenli biçimde ortak/sistem kaydı olarak
-- kalır (user_id NULL). Bundan sonraki kullanıcı kayıtları sahipli tutulur.
alter table tracked_symbols add column if not exists user_id uuid;
alter table tracked_symbols alter column user_id set default auth.uid();
alter table tracked_symbols add column if not exists id bigint generated always as identity;
alter table tracked_symbols alter column id set generated always;
do $$
declare
  current_pk text;
  current_columns text;
begin
  select constraint_row.conname, constraint_row.columns
  into current_pk, current_columns
  from (
    select
      constraint_def.conname,
      string_agg(attribute_def.attname, ',' order by key_def.ordinality) as columns
    from pg_constraint constraint_def
    cross join lateral unnest(constraint_def.conkey)
      with ordinality as key_def(attnum, ordinality)
    join pg_attribute attribute_def
      on attribute_def.attrelid = constraint_def.conrelid
      and attribute_def.attnum = key_def.attnum
    where constraint_def.conrelid = 'public.tracked_symbols'::regclass
      and constraint_def.contype = 'p'
    group by constraint_def.conname
  ) constraint_row;

  if current_pk is not null and current_columns <> 'id' then
    execute format('alter table public.tracked_symbols drop constraint %I', current_pk);
    current_pk := null;
  end if;
  if current_pk is null then
    alter table public.tracked_symbols
      add constraint tracked_symbols_pkey primary key (id);
  end if;
end
$$;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tracked_symbols_user_id_fkey'
      and conrelid = 'public.tracked_symbols'::regclass
  ) then
    alter table public.tracked_symbols
      add constraint tracked_symbols_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end
$$;
create unique index if not exists tracked_symbols_owner_symbol_uidx
  on tracked_symbols (user_id, symbol) where user_id is not null;
create unique index if not exists tracked_symbols_system_symbol_uidx
  on tracked_symbols (symbol) where user_id is null;

-- Kullanıcı başına en fazla 50 sembol. Aynı kullanıcıdan eşzamanlı istekler
-- transaction-scoped advisory lock ile sıraya alınır; quota yarışla aşılamaz.
-- service_role sistem kayıtları bu sınırdan etkilenmez.
create or replace function public.enforce_tracked_symbols_quota()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() = 'service_role' then
    -- Ortak sistem sembollerinde de eşzamanlı seed turları yinelenen satır
    -- oluşturmasın. Partial unique index son savunma olarak kalır.
    new.user_id := null;
    perform pg_advisory_xact_lock(hashtextextended('system:' || new.symbol, 0));
    if exists (
      select 1 from public.tracked_symbols
      where user_id is null and symbol = new.symbol
    ) then
      return null;
    end if;
    return new;
  end if;

  -- RLS asıl yetki sınırıdır; bu erken kontrol security-definer quota
  -- sorgusunun başka bir kullanıcının doluluk durumunu sızdırmasını da önler.
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'İzleme kaydı için oturum açılmalıdır.';
  end if;
  -- PostgREST bulk insert eksik kolonları NULL gönderebilir; sahiplik yine de
  -- sunucu tarafında JWT'deki kullanıcıya sabitlenir.
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  if new.user_id is distinct from auth.uid() then
    raise exception using
      errcode = '42501',
      message = 'İzleme kaydı yalnız oturum sahibi adına oluşturulabilir.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

  -- Idempotent/upsert denemeleri quota doluyken de unique conflict'e ulaşabilsin.
  if exists (
    select 1 from public.tracked_symbols
    where user_id = new.user_id and symbol = new.symbol
  ) then
    return null;
  end if;

  if (select count(*) from public.tracked_symbols where user_id = new.user_id) >= 50 then
    raise exception using
      errcode = '23514',
      message = 'Bir kullanıcı en fazla 50 sembol izleyebilir.';
  end if;
  return new;
end
$$;
drop trigger if exists tracked_symbols_quota_trigger on tracked_symbols;
create trigger tracked_symbols_quota_trigger
  before insert on tracked_symbols
  for each row execute function public.enforce_tracked_symbols_quota();

-- Collector aynı sembolü farklı kullanıcı satırlarından yüzlerce kez
-- okumaz; bu view yalnız service_role'a açıktır.
create or replace view public.tracked_symbol_queue
with (security_invoker = true)
as select distinct symbol from public.tracked_symbols;
revoke all privileges on public.tracked_symbol_queue from anon, authenticated;
grant select on public.tracked_symbol_queue to service_role;

-- Geçmişteki bozuk bir kayıt migration'ı durdurmasın; NOT VALID kısıtı yine de
-- bundan sonraki tüm yazımlarda makul Yahoo hisse sembolü biçimini uygular.
alter table tracked_symbols drop constraint if exists tracked_symbols_symbol_format;
alter table tracked_symbols
  add constraint tracked_symbols_symbol_format
  check (symbol ~ '^[A-Z][A-Z0-9.\-]{0,14}$') not valid;

-- Son fiyatlar (sembol başına tek satır, toplayıcı günceller)
create table if not exists quotes (
  symbol text primary key,
  short_name text,
  currency text,
  price double precision,
  change_percent double precision,
  market_state text,
  updated_at timestamptz not null default now()
);

-- Döviz kurları (USD, EUR → TRY)
create table if not exists fx_rates (
  code text primary key,
  rate double precision not null,
  updated_at timestamptz not null default now()
);

-- Haber arşivi (yeniler eklenir, eskiler silinmez)
create table if not exists news (
  id text primary key,
  symbol text not null,
  title text not null,
  title_tr text, -- yabancı haberlerin Türkçe çevirisi (toplayıcı doldurur)
  publisher text,
  link text,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

-- Var olan kuruluma sütunu ekle (tablo zaten oluşturulmuşsa)
alter table news add column if not exists title_tr text;

-- AI analiz alanları (Haiku 4.5 doldurur; toplayıcıda ANTHROPIC_API_KEY varsa)
alter table news add column if not exists sentiment text;       -- positive | negative | neutral
alter table news add column if not exists reliability smallint; -- 1-10
alter table news add column if not exists ai_summary_tr text;   -- tek cümlelik Türkçe özet

create index if not exists news_symbol_published_idx
  on news (symbol, published_at desc);

-- Fırsat adayları (toplayıcı her turda yeniden üretir; sembol+vade başına tek satır)
create table if not exists candidates (
  symbol text not null,
  horizon text not null,            -- 'short' | 'long'
  market text,
  data jsonb not null,              -- mock aday şemasıyla birebir aynı aday nesnesi
  updated_at timestamptz not null default now(),
  primary key (symbol, horizon)
);

create index if not exists candidates_horizon_idx on candidates (horizon);

-- Her aday turu için artan jenerasyon numarası. Dinamik evrende seçilen semboller
-- turdan tura değiştiğinden, frontend yalnızca EN GÜNCEL jenerasyonu gösterir;
-- böylece önceki turdan kalan bayat satırlar listeyi kirletmez.
alter table candidates add column if not exists generation bigint;

-- ABD hisse evreni (Faz 1 tarama girdisi; usUniverse.js Nasdaq Trader'dan doldurur).
-- Haftada bir yenilenir; ~6000 düz hisse (ETF/test/varant/unit hariç).
create table if not exists us_universe (
  symbol text primary key,
  name text,
  exchange text,
  refreshed_at timestamptz not null default now()
);

create index if not exists us_universe_refreshed_idx on us_universe (refreshed_at);

-- Dört risk seviyeli ortak model portföylerin güncel sürüm işaretçileri.
-- Aday turu 6 saatliktir; sepet bileşimi aylık dönem boyunca değişmez.
create table if not exists model_portfolios (
  slug text primary key,
  risk_tier smallint not null check (risk_tier between 1 and 4),
  source_generation bigint not null,
  generated_at timestamptz not null,
  valid_until timestamptz not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists model_portfolios_generated_idx on model_portfolios (generated_at desc);

-- Her 6 saatlik derin analizin aylık konsensüs için kullanılan kompakt özeti.
create table if not exists candidate_analysis_snapshots (
  generation bigint not null,
  source_symbol text not null,
  symbol text not null,
  horizon text not null check (horizon in ('short', 'long')),
  captured_at timestamptz not null,
  market text,
  opportunity_score double precision not null check (opportunity_score between 0 and 100),
  rank smallint check (rank is null or rank > 0),
  profile_scores jsonb not null default '{}'::jsonb,
  eligibility jsonb not null default '{}'::jsonb,
  factor_scores jsonb not null default '{}'::jsonb,
  risk_level text,
  liquidity_level text,
  expected_return_pct double precision,
  conviction_rule_score double precision,
  conviction_score double precision,
  ai_used boolean not null default false,
  ai_cache_hit boolean not null default false,
  ai_certainty double precision,
  evidence_signature text,
  analysis_depth text,
  primary key (generation, source_symbol, horizon)
);
alter table candidate_analysis_snapshots add column if not exists source_symbol text;
alter table candidate_analysis_snapshots add column if not exists conviction_rule_score double precision;
alter table candidate_analysis_snapshots add column if not exists ai_used boolean not null default false;
alter table candidate_analysis_snapshots add column if not exists ai_cache_hit boolean not null default false;
alter table candidate_analysis_snapshots add column if not exists ai_certainty double precision;
alter table candidate_analysis_snapshots add column if not exists evidence_signature text;
update candidate_analysis_snapshots
set source_symbol = case
  when upper(coalesce(market, '')) = 'BIST' and upper(symbol) !~ '\.IS$'
    then upper(symbol) || '.IS'
  else upper(symbol)
end
where source_symbol is null;
alter table candidate_analysis_snapshots alter column source_symbol set not null;
do $$
declare
  current_pk text;
  current_definition text;
begin
  select conname, pg_get_constraintdef(oid)
  into current_pk, current_definition
  from pg_constraint
  where conrelid = 'public.candidate_analysis_snapshots'::regclass
    and contype = 'p'
  limit 1;

  if current_pk is not null and position('source_symbol' in current_definition) = 0 then
    execute format(
      'alter table public.candidate_analysis_snapshots drop constraint %I',
      current_pk
    );
    current_pk := null;
  end if;
  if current_pk is null then
    alter table public.candidate_analysis_snapshots
      add constraint candidate_analysis_snapshots_pkey
      primary key (generation, source_symbol, horizon);
  end if;
end
$$;
drop index if exists candidate_analysis_snapshots_generation_source_uidx;
create index if not exists candidate_analysis_snapshots_captured_idx
  on candidate_analysis_snapshots (captured_at desc);
create index if not exists candidate_analysis_snapshots_symbol_idx
  on candidate_analysis_snapshots (source_symbol, horizon, captured_at desc);

-- Konsensüs son 30 günü okur; 60 günlük tampon hata incelemesine alan bırakır
-- ve kompakt snapshot tablosunun sınırsız büyümesini önler. Doğrudan DELETE
-- yetkisi verilmez; bakım yalnız service_role RPC'si üzerinden yapılır.
create or replace function public.prune_candidate_analysis_snapshots(
  p_keep_days integer default 60
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  deleted_count bigint;
begin
  if p_keep_days is null or p_keep_days < 30 or p_keep_days > 365 then
    raise exception using
      errcode = '22023',
      message = 'Analiz geçmişi saklama süresi 30 ile 365 gün arasında olmalıdır.';
  end if;
  delete from public.candidate_analysis_snapshots
  where captured_at < now() - (interval '1 day' * p_keep_days);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end
$$;
revoke all on function public.prune_candidate_analysis_snapshots(integer)
  from public, anon, authenticated;
grant execute on function public.prune_candidate_analysis_snapshots(integer)
  to service_role;

-- Aylık, değişmez model portföy sürümleri. Üyelik ve ağırlıklar vade boyunca
-- sabit kalır; yeni aday turları ancak sonraki sürümün girdisi olur.
create table if not exists model_portfolio_versions (
  version_key text primary key,
  slug text not null,
  risk_tier smallint not null check (risk_tier between 1 and 4),
  source_generation bigint not null,
  cycle_start timestamptz not null,
  cycle_end timestamptz not null,
  status text not null default 'active' check (status in ('active', 'completed')),
  methodology_version text not null,
  base_currency text not null default 'TRY' check (base_currency = 'TRY'),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug, cycle_start),
  check (cycle_end > cycle_start)
);
create index if not exists model_portfolio_versions_cycle_idx
  on model_portfolio_versions (cycle_start desc, risk_tier asc);
create index if not exists model_portfolio_versions_active_idx
  on model_portfolio_versions (cycle_end desc) where status = 'active';

-- Eski çalıştırmalardan kalan vadesi dolmuş aktif kayıtları tekillik kısıtından
-- önce kapat. Hâlâ aynı slug için birden fazla aktif sürüm varsa veri seçimini
-- tahmin etmek yerine ayrıntılı hata ver ve operatörün düzeltmesini iste.
update model_portfolio_versions
set status = 'completed', updated_at = now()
where status = 'active' and cycle_end <= now();
do $$
declare
  duplicate_details text;
begin
  select string_agg(format('%s => %s', slug, version_keys), '; ' order by slug)
  into duplicate_details
  from (
    select
      slug,
      string_agg(
        format('%s (cycle_end=%s)', version_key, cycle_end),
        ', ' order by cycle_start desc
      ) as version_keys
    from public.model_portfolio_versions
    where status = 'active'
    group by slug
    having count(*) > 1
  ) duplicates;

  if duplicate_details is not null then
    raise exception using
      errcode = '23505',
      message = 'Aynı slug için birden fazla aktif model portföy sürümü bulundu: ' || duplicate_details,
      hint = 'Doğru sürümü active bırakıp diğerlerini completed yaptıktan sonra migrationı yeniden çalıştırın.';
  end if;
end
$$;
create unique index if not exists model_portfolio_versions_one_active_slug_idx
  on model_portfolio_versions (slug) where status = 'active';

-- Günlük TL bazlı NAV ve aynı döneme normalize benchmark sonuçları.
create table if not exists model_portfolio_nav (
  version_key text not null references model_portfolio_versions(version_key) on delete restrict,
  nav_date date not null,
  observed_at timestamptz not null,
  nav_value double precision not null check (nav_value > 0),
  return_pct double precision not null,
  coverage_pct double precision not null check (coverage_pct between 0 and 100),
  benchmarks jsonb not null default '{}'::jsonb,
  primary key (version_key, nav_date)
);
create index if not exists model_portfolio_nav_date_idx on model_portfolio_nav (nav_date desc);

-- Aynı gün için geç biten eski bir collector turu, daha yeni fiyatlarla
-- yazılmış NAV noktasını geriye alamaz.
create or replace function public.keep_newest_model_portfolio_nav()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.observed_at < old.observed_at then
    return null;
  end if;
  return new;
end
$$;
drop trigger if exists model_portfolio_nav_keep_newest on model_portfolio_nav;
create trigger model_portfolio_nav_keep_newest
  before update on model_portfolio_nav
  for each row execute function public.keep_newest_model_portfolio_nav();

-- Dönem değişimi tek transaction'da yapılır: eski dört sürüm kapanır, kapanış
-- NAV'ları yazılır, yeni dört sürüm ve başlangıç NAV'ları eklenir, ardından
-- geriye uyumlu current pointer'lar güncellenir. Bir adım hata verirse tamamı
-- geri alınır; sistem yarım bir aylık kümeyle kalmaz.
create or replace function public.publish_model_portfolio_cycle(
  p_decision_at timestamptz,
  p_previous_version_keys text[],
  p_closing_nav jsonb,
  p_versions jsonb,
  p_initial_nav jsonb,
  p_current_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  payload_count integer;
  stored_count integer;
  version_key_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('model-portfolio-cycle-publish', 0));

  if p_decision_at is null then
    raise exception using errcode = '22004', message = 'p_decision_at zorunludur.';
  end if;
  if jsonb_typeof(coalesce(p_versions, 'null'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'Aylık sürüm yükü dizi olmalıdır.';
  end if;
  if jsonb_array_length(p_versions) <> 4 then
    raise exception using errcode = '22023', message = 'Tam olarak dört aylık sürüm gönderilmelidir.';
  end if;
  if jsonb_typeof(coalesce(p_initial_nav, 'null'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'Başlangıç NAV yükü dizi olmalıdır.';
  end if;
  if jsonb_array_length(p_initial_nav) <> 4 then
    raise exception using errcode = '22023', message = 'Tam olarak dört başlangıç NAV satırı gönderilmelidir.';
  end if;
  if jsonb_typeof(coalesce(p_current_rows, 'null'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'Current pointer yükü dizi olmalıdır.';
  end if;
  if jsonb_array_length(p_current_rows) <> 4 then
    raise exception using errcode = '22023', message = 'Tam olarak dört current pointer gönderilmelidir.';
  end if;
  if jsonb_typeof(coalesce(p_closing_nav, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'Kapanış NAV yükü dizi olmalıdır.';
  end if;

  select count(distinct x.slug), count(distinct x.risk_tier), count(distinct x.version_key)
  into payload_count, stored_count, version_key_count
  from jsonb_to_recordset(p_versions) as x(
    version_key text,
    slug text,
    risk_tier smallint
  );
  if payload_count <> 4 or stored_count <> 4 or version_key_count <> 4 then
    raise exception using
      errcode = '23514',
      message = 'Aylık sürüm yükünde dört benzersiz version key, slug ve risk seviyesi bulunmalıdır.';
  end if;
  select count(distinct x.version_key)
  into payload_count
  from jsonb_to_recordset(p_initial_nav) as x(version_key text);
  if payload_count <> 4 or exists (
    select initial_row.version_key
    from jsonb_to_recordset(p_initial_nav) as initial_row(version_key text)
    except
    select version_row.version_key
    from jsonb_to_recordset(p_versions) as version_row(version_key text)
  ) then
    raise exception using errcode = '23514', message = 'Başlangıç NAV sürüm anahtarları aylık kümeyle eşleşmiyor.';
  end if;
  select count(distinct x.slug), count(distinct x.risk_tier)
  into payload_count, stored_count
  from jsonb_to_recordset(p_current_rows) as x(slug text, risk_tier smallint);
  if payload_count <> 4 or stored_count <> 4 or exists (
    select current_row.slug
    from jsonb_to_recordset(p_current_rows) as current_row(slug text)
    except
    select version_row.slug
    from jsonb_to_recordset(p_versions) as version_row(slug text)
  ) then
    raise exception using errcode = '23514', message = 'Current pointer kümesi aylık sürümlerle eşleşmiyor.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_closing_nav, '[]'::jsonb)) as closing_row(version_key text)
    where not (
      closing_row.version_key = any(coalesce(p_previous_version_keys, array[]::text[]))
    )
  ) then
    raise exception using errcode = '23514', message = 'Kapanış NAV anahtarı önceki sürüm kümesinde değil.';
  end if;
  if cardinality(coalesce(p_previous_version_keys, array[]::text[])) > 0 and exists (
    select previous_key
    from unnest(p_previous_version_keys) as previous_keys(previous_key)
    except
    select closing_row.version_key
    from jsonb_to_recordset(coalesce(p_closing_nav, '[]'::jsonb)) as closing_row(version_key text)
  ) then
    raise exception using errcode = '23514', message = 'Önceki aylık sürümlerin kapanış NAV satırı eksik.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_versions) as x(
      cycle_start timestamptz,
      cycle_end timestamptz,
      status text,
      base_currency text
    )
    where x.cycle_start is distinct from p_decision_at
       or x.cycle_end <= x.cycle_start
       or x.status <> 'active'
       or x.base_currency <> 'TRY'
  ) then
    raise exception using errcode = '23514', message = 'Aylık sürüm tarih/durum yükü geçersizdir.';
  end if;

  insert into public.model_portfolio_nav (
    version_key, nav_date, observed_at, nav_value, return_pct, coverage_pct, benchmarks
  )
  select
    x.version_key, x.nav_date, x.observed_at, x.nav_value,
    x.return_pct, x.coverage_pct, coalesce(x.benchmarks, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_closing_nav, '[]'::jsonb)) as x(
    version_key text,
    nav_date date,
    observed_at timestamptz,
    nav_value double precision,
    return_pct double precision,
    coverage_pct double precision,
    benchmarks jsonb
  )
  on conflict (version_key, nav_date) do update
  set observed_at = excluded.observed_at,
      nav_value = excluded.nav_value,
      return_pct = excluded.return_pct,
      coverage_pct = excluded.coverage_pct,
      benchmarks = excluded.benchmarks
  where excluded.observed_at >= model_portfolio_nav.observed_at;

  update public.model_portfolio_versions
  set status = 'completed', cycle_end = p_decision_at, updated_at = p_decision_at
  where status = 'active'
    and (
      version_key = any(coalesce(p_previous_version_keys, array[]::text[]))
      or cycle_end <= p_decision_at
    );

  if exists (select 1 from public.model_portfolio_versions where status = 'active') then
    raise exception using
      errcode = '23505',
      message = 'Yeni dönem açılırken ilgisiz bir aktif model portföy sürümü bulundu.';
  end if;

  insert into public.model_portfolio_versions (
    version_key, slug, risk_tier, source_generation, cycle_start, cycle_end,
    status, methodology_version, base_currency, data, created_at, updated_at
  )
  select
    x.version_key, x.slug, x.risk_tier, x.source_generation, x.cycle_start,
    x.cycle_end, x.status, x.methodology_version, x.base_currency, x.data,
    x.created_at, x.updated_at
  from jsonb_to_recordset(p_versions) as x(
    version_key text,
    slug text,
    risk_tier smallint,
    source_generation bigint,
    cycle_start timestamptz,
    cycle_end timestamptz,
    status text,
    methodology_version text,
    base_currency text,
    data jsonb,
    created_at timestamptz,
    updated_at timestamptz
  )
  on conflict (version_key) do nothing;

  select count(distinct stored.version_key)
  into stored_count
  from public.model_portfolio_versions stored
  join jsonb_to_recordset(p_versions) as requested(version_key text)
    on requested.version_key = stored.version_key
  where stored.status = 'active';
  if stored_count <> 4 then
    raise exception using errcode = '23514', message = 'Dört aktif aylık sürüm atomik olarak kaydedilemedi.';
  end if;

  insert into public.model_portfolio_nav (
    version_key, nav_date, observed_at, nav_value, return_pct, coverage_pct, benchmarks
  )
  select
    x.version_key, x.nav_date, x.observed_at, x.nav_value,
    x.return_pct, x.coverage_pct, coalesce(x.benchmarks, '{}'::jsonb)
  from jsonb_to_recordset(p_initial_nav) as x(
    version_key text,
    nav_date date,
    observed_at timestamptz,
    nav_value double precision,
    return_pct double precision,
    coverage_pct double precision,
    benchmarks jsonb
  )
  on conflict (version_key, nav_date) do nothing;

  insert into public.model_portfolios (
    slug, risk_tier, source_generation, generated_at, valid_until, data, updated_at
  )
  select
    x.slug, x.risk_tier, x.source_generation, x.generated_at,
    x.valid_until, x.data, x.updated_at
  from jsonb_to_recordset(p_current_rows) as x(
    slug text,
    risk_tier smallint,
    source_generation bigint,
    generated_at timestamptz,
    valid_until timestamptz,
    data jsonb,
    updated_at timestamptz
  )
  on conflict (slug) do update
  set risk_tier = excluded.risk_tier,
      source_generation = excluded.source_generation,
      generated_at = excluded.generated_at,
      valid_until = excluded.valid_until,
      data = excluded.data,
      updated_at = excluded.updated_at;

  return stored_count;
end
$$;
revoke all on function public.publish_model_portfolio_cycle(
  timestamptz, text[], jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.publish_model_portfolio_cycle(
  timestamptz, text[], jsonb, jsonb, jsonb, jsonb
) to service_role;

-- Satır düzeyi güvenlik: anon anahtar yalnızca okuyabilir,
-- yazma işlemleri service_role anahtarıyla (toplayıcı) yapılır.
alter table tracked_symbols enable row level security;
alter table quotes enable row level security;
alter table fx_rates enable row level security;
alter table news enable row level security;
alter table candidates enable row level security;
alter table us_universe enable row level security;
alter table model_portfolios enable row level security;
alter table candidate_analysis_snapshots enable row level security;
alter table model_portfolio_versions enable row level security;
alter table model_portfolio_nav enable row level security;

-- (drop+create: dosya tekrar çalıştırıldığında hata vermez)
drop policy if exists "herkes okur" on tracked_symbols;
drop policy if exists "herkes okur" on quotes;
drop policy if exists "herkes okur" on fx_rates;
drop policy if exists "herkes okur" on news;
drop policy if exists "herkes okur" on candidates;
drop policy if exists "herkes okur" on us_universe;
drop policy if exists "herkes okur" on model_portfolios;
drop policy if exists "herkes okur" on model_portfolio_versions;
drop policy if exists "herkes okur" on model_portfolio_nav;
drop policy if exists "anon sembol ekler" on tracked_symbols;
drop policy if exists "giris yapan sembol ekler" on tracked_symbols;
drop policy if exists "giris yapan okur" on tracked_symbols;
drop policy if exists "anon sistem sembollerini okur" on tracked_symbols;
drop policy if exists "giris yapan kendi sembollerini okur" on tracked_symbols;
drop policy if exists "giris yapan kendi sembolunu ekler" on tracked_symbols;
drop policy if exists "giris yapan kendi sembolunu siler" on tracked_symbols;

create policy "anon sistem sembollerini okur" on tracked_symbols
  for select to anon using (user_id is null);
create policy "giris yapan kendi sembollerini okur" on tracked_symbols
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy "herkes okur" on quotes for select using (true);
create policy "herkes okur" on fx_rates for select using (true);
create policy "herkes okur" on news for select using (true);
create policy "herkes okur" on candidates for select using (true);
create policy "herkes okur" on us_universe for select using (true);
create policy "herkes okur" on model_portfolios for select using (true);
create policy "herkes okur" on model_portfolio_versions for select using (true);
create policy "herkes okur" on model_portfolio_nav for select using (true);

-- Varsayılan user_id=auth.uid() istemcinin mevcut { symbol } payload'unu korur;
-- başka kullanıcı veya NULL sistem sahibi taklit edilemez.
create policy "giris yapan kendi sembolunu ekler" on tracked_symbols
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "giris yapan kendi sembolunu siler" on tracked_symbols
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Yeni Supabase projelerinde PostgREST erişimi için açık yetkiler gerekir
grant usage on schema public to anon, authenticated, service_role;
grant select on tracked_symbols, quotes, fx_rates, news, candidates, us_universe, model_portfolios, model_portfolio_versions, model_portfolio_nav to anon, authenticated;
revoke all privileges on tracked_symbols from anon, authenticated;
grant select on tracked_symbols to anon, authenticated;
grant insert on tracked_symbols to authenticated;
grant delete on tracked_symbols to authenticated;
grant all on tracked_symbols, quotes, fx_rates, news, candidates, us_universe, model_portfolios, model_portfolio_versions, model_portfolio_nav to service_role;
revoke all privileges on model_portfolio_versions, model_portfolio_nav from service_role;
grant select on model_portfolio_versions to service_role;
grant select, insert, update on model_portfolio_nav to service_role;
revoke all privileges on candidate_analysis_snapshots from anon, authenticated;
revoke update, delete, truncate, references, trigger
  on candidate_analysis_snapshots from service_role;
grant select, insert on candidate_analysis_snapshots to service_role;

-- PK/policy değişikliklerini PostgREST'in hemen görmesini sağla.
notify pgrst, 'reload schema';

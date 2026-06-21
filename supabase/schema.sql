-- PortföyAI bulut veri şeması
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run

-- Uygulamanın izlediği semboller (Yahoo formatında: THYAO.IS, AAPL...)
create table if not exists tracked_symbols (
  symbol text primary key,
  added_at timestamptz not null default now()
);

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

-- Satır düzeyi güvenlik: anon anahtar yalnızca okuyabilir,
-- yazma işlemleri service_role anahtarıyla (toplayıcı) yapılır.
alter table tracked_symbols enable row level security;
alter table quotes enable row level security;
alter table fx_rates enable row level security;
alter table news enable row level security;
alter table candidates enable row level security;
alter table us_universe enable row level security;

-- (drop+create: dosya tekrar çalıştırıldığında hata vermez)
drop policy if exists "herkes okur" on tracked_symbols;
drop policy if exists "herkes okur" on quotes;
drop policy if exists "herkes okur" on fx_rates;
drop policy if exists "herkes okur" on news;
drop policy if exists "herkes okur" on candidates;
drop policy if exists "herkes okur" on us_universe;
drop policy if exists "anon sembol ekler" on tracked_symbols;

create policy "herkes okur" on tracked_symbols for select using (true);
create policy "herkes okur" on quotes for select using (true);
create policy "herkes okur" on fx_rates for select using (true);
create policy "herkes okur" on news for select using (true);
create policy "herkes okur" on candidates for select using (true);
create policy "herkes okur" on us_universe for select using (true);

-- Uygulama yeni hisse eklendiğinde sembolü izlemeye alabilsin
create policy "anon sembol ekler" on tracked_symbols for insert with check (true);

-- Yeni Supabase projelerinde PostgREST erişimi için açık yetkiler gerekir
grant usage on schema public to anon, authenticated, service_role;
grant select on tracked_symbols, quotes, fx_rates, news, candidates, us_universe to anon, authenticated;
grant insert on tracked_symbols to anon, authenticated;
grant all on tracked_symbols, quotes, fx_rates, news, candidates, us_universe to service_role;

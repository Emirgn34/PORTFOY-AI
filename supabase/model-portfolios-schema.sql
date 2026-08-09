-- Ortak, salt-okunur model portföy snapshot'ları.
-- Aday üreticisi service_role ile 6 saatte bir günceller; kullanıcılar yalnızca okur.
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
alter table model_portfolios enable row level security;
drop policy if exists "model portfoyleri okunur" on model_portfolios;
create policy "model portfoyleri okunur" on model_portfolios for select using (true);
grant select on model_portfolios to anon, authenticated;
grant all on model_portfolios to service_role;

-- Mevcut kurulumlarda ana schema.sql dosyasını yeniden çalıştırmadan ortak
-- tarama kuyruğunu da güvenli hale getir. Yalnız oturum açmış kullanıcı yazar;
-- collector service_role ile çalışmaya devam eder.
alter table tracked_symbols drop constraint if exists tracked_symbols_symbol_format;
alter table tracked_symbols
  add constraint tracked_symbols_symbol_format
  check (symbol ~ '^[A-Z][A-Z0-9.\-]{0,14}$') not valid;

drop policy if exists "anon sembol ekler" on tracked_symbols;
drop policy if exists "giris yapan sembol ekler" on tracked_symbols;
create policy "giris yapan sembol ekler" on tracked_symbols
  for insert to authenticated with check (true);
revoke insert on tracked_symbols from anon;
grant insert on tracked_symbols to authenticated;

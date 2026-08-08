-- PortföyAI backtest (ileri-test) şeması
--
-- Amaç: her aday üretim turunda hesaplanan fırsat skorlarının ANLIK GÖRÜNTÜSÜNÜ
-- saklamak. Daha sonra (vade dolunca) bu skorların gerçekten getiriyi öngörüp
-- öngörmediği ölçülür. Tarihsel skor tutmadığımız için geriye dönük backtest
-- mümkün değil; bu tablo BUGÜNDEN itibaren bir track record biriktirir.
--
-- candidates tablosu sembol+vade başına TEK satır tutar (üzerine yazar); bu tablo
-- ise her turda YENİ satır ekler (append), böylece zaman serisi oluşur.
--
-- Supabase SQL editöründe bir kez çalıştırın.

create table if not exists score_snapshots (
  id            bigint generated always as identity primary key,
  captured_at   timestamptz not null default now(),
  symbol        text not null,
  horizon       text not null,            -- 'short' | 'long'
  market        text,
  score         smallint not null,        -- 0-100 fırsat skoru
  score_label   text,
  rank          smallint,                 -- o turdaki vade-içi sıra
  capture_price numeric,                  -- anlık fiyat (kendi para biriminde)
  currency      text
);

-- Mevcut kurulumlar için ileri-test v2 alanları.
alter table score_snapshots add column if not exists generation bigint;
alter table score_snapshots add column if not exists signal_key text;
alter table score_snapshots add column if not exists conviction_rule_score smallint;
alter table score_snapshots add column if not exists conviction_final_score smallint;
alter table score_snapshots add column if not exists ai_used boolean not null default false;
alter table score_snapshots add column if not exists ai_cache_hit boolean not null default false;
alter table score_snapshots add column if not exists ai_certainty smallint;
alter table score_snapshots add column if not exists evidence_signature text;

-- Altı saatte bir üretilen aynı günlük aday dört ayrı işlem sayılmasın.
create unique index if not exists score_snapshots_signal_key_uidx
  on score_snapshots (signal_key) where signal_key is not null;

create index if not exists score_snapshots_captured_idx
  on score_snapshots (captured_at desc);
create index if not exists score_snapshots_symbol_idx
  on score_snapshots (symbol, horizon, captured_at desc);

-- Satır düzeyi güvenlik: yazma service_role (toplayıcı) ile; okuma giriş yapan kullanıcı.
alter table score_snapshots enable row level security;

drop policy if exists "giris yapan okur" on score_snapshots;
create policy "giris yapan okur" on score_snapshots
  for select to authenticated using (true);

grant select on score_snapshots to authenticated;
grant all on score_snapshots to service_role;

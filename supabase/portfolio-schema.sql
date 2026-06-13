-- PortföyAI kullanıcıya özel portföy şeması
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run
--
-- Her kullanıcının portföyü kendi satırında (user_id) jsonb olarak tutulur.
-- RLS: kullanıcı YALNIZCA kendi satırını görebilir/değiştirebilir — başka hiç
-- kimse (admin dahil, anon istemciyle) erişemez. Veri buluta bağlı olduğundan
-- kullanıcı hangi cihazdan girerse girsin aynı portföyü görür.

create table if not exists portfolios (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stocks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table portfolios enable row level security;

-- Tek politika: sahibi tüm işlemleri (okuma/ekleme/güncelleme/silme) yapabilir
drop policy if exists "kendi portfoyu" on portfolios;
create policy "kendi portfoyu" on portfolios
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on portfolios to authenticated;

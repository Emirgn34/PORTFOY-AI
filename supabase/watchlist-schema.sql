-- PortföyAI kullanıcıya özel izleme listesi şeması
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run
--
-- portfolios ile aynı desen: her kullanıcının izleme listesi kendi satırında
-- (user_id) jsonb olarak tutulur; RLS ile yalnızca sahibi erişir. Böylece
-- izleme listesi de cihazdan bağımsız, hesaba bağlı ve izoledir.

create table if not exists watchlists (
  user_id uuid primary key references auth.users (id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table watchlists enable row level security;

drop policy if exists "kendi izleme listesi" on watchlists;
create policy "kendi izleme listesi" on watchlists
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on watchlists to authenticated;

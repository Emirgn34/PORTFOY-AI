-- PortföyAI kullanıcıya özel portföy analizi (Portföy Yorumu) şeması
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run
--
-- "Portföyümü Analiz Et" sonucu kullanıcının satırında saklanır; tekrar açılışta
-- AI çağrısı yapmadan hızlıca okunur. RLS: yalnızca sahibi erişir. Yazma
-- service_role (Vercel fonksiyonu) ile yapılır; kullanıcı kendi satırını okur.

create table if not exists portfolio_analyses (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table portfolio_analyses enable row level security;

drop policy if exists "kendi analizi" on portfolio_analyses;
create policy "kendi analizi" on portfolio_analyses
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on portfolio_analyses to authenticated;

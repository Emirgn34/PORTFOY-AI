-- PortföyAI kimlik doğrulama + erişim kilidi şeması
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run
--
-- Bu dosya iki şey yapar:
--   1. profiles tablosu (kullanıcı adı + rol) + otomatik oluşturma tetikleyicisi
--   2. Veri tablolarının RLS'ini KİLİTLER: artık yalnızca giriş yapmış
--      kullanıcı okuyabilir (anon anahtarla okuma kapanır).
--
-- Çalıştırmadan ÖNCE Supabase panelinde:
--   Authentication → Sign In / Providers → Email sağlayıcısını AÇ.
--   "Allow new users to sign up" / "Confirm email" → KAPAT (admin hesap açar).

-- ============================================================================
-- 1) Kullanıcı profilleri (rol + görünen kullanıcı adı)
-- ============================================================================
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  role text not null default 'user',          -- 'admin' | 'user'
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- Giriş yapan kullanıcı YALNIZCA kendi profilini okuyabilir (rolünü öğrenmek için).
-- Tüm kullanıcıları listeleme/oluşturma/silme service_role ile (admin API) yapılır,
-- o da RLS'i aşar; bu yüzden burada ek politika gerekmez.
drop policy if exists "kendi profilini okur" on profiles;
create policy "kendi profilini okur" on profiles
  for select to authenticated using (auth.uid() = id);

-- Yeni auth kullanıcısı oluşunca otomatik profil satırı aç (rol: user).
-- security definer → RLS'i aşarak insert yapabilir.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'role', 'user')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

grant select on profiles to authenticated;
grant all on profiles to service_role;

-- ============================================================================
-- 2) Veri tablolarını KİLİTLE — yalnızca giriş yapmış kullanıcı okur
-- ============================================================================
-- Eski "herkes okur" (anon dahil) politikalarını kaldır
drop policy if exists "herkes okur" on tracked_symbols;
drop policy if exists "herkes okur" on quotes;
drop policy if exists "herkes okur" on fx_rates;
drop policy if exists "herkes okur" on news;
drop policy if exists "herkes okur" on candidates;
drop policy if exists "anon sembol ekler" on tracked_symbols;

-- Yalnızca authenticated rolü okuyabilir
create policy "giris yapan okur" on tracked_symbols for select to authenticated using (true);
create policy "giris yapan okur" on quotes for select to authenticated using (true);
create policy "giris yapan okur" on fx_rates for select to authenticated using (true);
create policy "giris yapan okur" on news for select to authenticated using (true);
create policy "giris yapan okur" on candidates for select to authenticated using (true);

-- Giriş yapan kullanıcı yeni hisse eklediğinde sembolü izlemeye alabilsin
create policy "giris yapan sembol ekler" on tracked_symbols for insert to authenticated with check (true);

-- anon rolünden okuma/yazma yetkisini geri al (RLS politikası + yetki birlikte kapatır)
revoke select on tracked_symbols, quotes, fx_rates, news, candidates from anon;
revoke insert on tracked_symbols from anon;

-- authenticated rolüne okuma + sembol ekleme yetkisi (RLS yine satır bazında sınırlar)
grant select on tracked_symbols, quotes, fx_rates, news, candidates to authenticated;
grant insert on tracked_symbols to authenticated;

-- ============================================================================
-- 3) İLK ADMİN BOOTSTRAP (bir kez, manuel)
-- ============================================================================
-- a) Supabase paneli → Authentication → Users → "Add user":
--      Email:    admin@portfoy.local   (auth.js AUTH_EMAIL_DOMAIN ile aynı olmalı)
--      Password: (kendi güçlü parolan)
--      "Auto Confirm User" → İŞARETLE
-- b) Sonra aşağıdaki satırı çalıştır (kullanıcı adı 'admin', rol 'admin' yapar):
--
--   insert into profiles (id, username, role)
--   select id, 'admin', 'admin' from auth.users where email = 'admin@portfoy.local'
--   on conflict (id) do update set username = 'admin', role = 'admin';
--
-- Artık siteye kullanıcı adı "admin" + parolanla girip Admin panelinden
-- diğer kullanıcıları ekleyebilirsin.

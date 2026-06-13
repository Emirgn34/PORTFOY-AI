/**
 * Kimlik doğrulama yardımcıları.
 *
 * Supabase Auth teknik olarak e-posta ile çalışır; biz kullanıcıdan yalnızca
 * KULLANICI ADI + PAROLA isteriz ve arka planda kullanıcı adını sabit bir iç
 * alan adına (AUTH_EMAIL_DOMAIN) çevirerek e-posta üretiriz. Böylece kullanıcı
 * hiç e-posta görmez. Admin'in oluşturduğu hesaplar otomatik onaylıdır
 * (e-posta doğrulama akışı yoktur).
 *
 * ÖNEMLİ: Bu alan adı SQL bootstrap'taki admin e-postasıyla (admin@portfoy.local)
 * aynı olmalıdır. Değiştirirsen iki yeri birlikte güncelle.
 */
import { supabase } from './supabaseClient.js';

export const AUTH_EMAIL_DOMAIN = 'portfoy.local';

/** Kullanıcı adını iç e-postaya çevirir (ali → ali@portfoy.local). */
export function usernameToEmail(username) {
  return `${String(username).trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;
}

/** İç e-postadan kullanıcı adını çıkarır (ali@portfoy.local → ali). */
export function emailToUsername(email) {
  return String(email ?? '').replace(new RegExp(`@${AUTH_EMAIL_DOMAIN}$`), '');
}

/**
 * Kullanıcı adı + parola ile giriş yapar.
 * Dönüş: { error } — hata yoksa error null'dur.
 */
export async function signIn(username, password) {
  if (!supabase) return { error: new Error('Kimlik servisi yapılandırılmamış.') };
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
  return { error };
}

/** Oturumu kapatır. */
export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

/** Mevcut oturumu döndürür (yoksa null). */
export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

/**
 * Giriş yapan kullanıcının profilini (kullanıcı adı + rol) getirir.
 * Dönüş: { username, role } veya null.
 */
export async function getProfile(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('username, role')
    .eq('id', userId)
    .single();
  if (error) return null;
  return data;
}

/** Giriş yapan kullanıcının erişim token'ı (API çağrılarında Authorization için). */
export async function getAccessToken() {
  const session = await getSession();
  return session?.access_token ?? null;
}

/** Giriş yapan kullanıcının kendi parolasını değiştirir. Dönüş: { error }. */
export async function updatePassword(newPassword) {
  if (!supabase) return { error: new Error('Kimlik servisi yapılandırılmamış.') };
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  return { error };
}

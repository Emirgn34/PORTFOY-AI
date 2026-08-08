/** Hesap ayarları için tarayıcıdan bağımsız doğrulama yardımcıları. */

export const USERNAME_PATTERN = /^[a-z0-9_.-]{3,32}$/;

export function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function validateUsername(value) {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) {
    return {
      username,
      error: 'Kullanıcı adı 3-32 karakter olmalı; yalnızca harf, rakam, nokta, alt çizgi ve tire kullanılabilir.',
    };
  }
  return { username, error: null };
}

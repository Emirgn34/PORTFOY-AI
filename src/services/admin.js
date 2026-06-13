/**
 * Admin kullanıcı yönetimi istemci yardımcıları.
 * /api/admin/users fonksiyonunu çağıran kullanıcının erişim token'ıyla çağırır
 * (service_role anahtarı asla tarayıcıda tutulmaz — yetki sunucuda doğrulanır).
 */
import { getAccessToken } from './auth.js';

async function authedFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token ?? ''}`,
      ...(options.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'İşlem başarısız.');
  return body;
}

/** Tüm kullanıcıları getirir: [{ id, username, role, created_at }]. */
export async function listUsers() {
  const { users } = await authedFetch('/api/admin/users');
  return users;
}

/** Yeni kullanıcı oluşturur. */
export async function createUser({ username, password, role }) {
  return authedFetch('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ username, password, role }),
  });
}

/** Kullanıcıyı siler. */
export async function deleteUser(id) {
  return authedFetch(`/api/admin/users?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

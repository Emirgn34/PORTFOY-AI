import test from 'node:test';
import assert from 'node:assert/strict';
import { listManagedUsers } from '../server/adminUsers.js';

function client(authUsers, profiles, failurePage) {
  const pages = [];
  return {
    pages,
    auth: { admin: { listUsers: async ({ page, perPage }) => {
      pages.push(page);
      if (page === failurePage) return { data: null, error: new Error('Auth servisi kullanılamıyor') };
      return { data: { users: authUsers.slice((page - 1) * perPage, page * perPage) }, error: null };
    } } },
    from: () => ({ select: () => ({ in: async (_column, ids) => ({
      data: profiles.filter((profile) => ids.includes(profile.id)), error: null,
    }) }) }),
  };
}

test('son giriş tarihlerini kullanıcı kimliğiyle eşleştirir, özel Auth alanlarını döndürmez', async () => {
  const sb = client([
    { id: 'new', last_sign_in_at: null, email: 'private@example.com', app_metadata: { secret: true } },
    { id: 'old', last_sign_in_at: '2026-09-17T09:30:00Z', identities: ['private'] },
  ], [
    { id: 'old', username: 'eski', role: 'admin', created_at: '2026-01-01T00:00:00Z' },
    { id: 'new', username: 'yeni', role: 'user', created_at: '2026-08-01T00:00:00Z' },
  ]);
  assert.deepEqual(await listManagedUsers(sb), [
    { id: 'old', username: 'eski', role: 'admin', created_at: '2026-01-01T00:00:00Z', last_sign_in_at: '2026-09-17T09:30:00Z' },
    { id: 'new', username: 'yeni', role: 'user', created_at: '2026-08-01T00:00:00Z', last_sign_in_at: null },
  ]);
});

test('ilk sayfa dışındaki kullanıcıları da getirir; eksik tarihleri hiç giriş yapılmadı olarak döndürür', async () => {
  const authUsers = Array.from({ length: 201 }, (_, index) => ({ id: String(index) }));
  const profiles = authUsers.map(({ id }) => ({ id, username: `user${id}`, role: 'user', created_at: '2026-01-01T00:00:00Z' }));
  const sb = client(authUsers, profiles);
  const users = await listManagedUsers(sb);
  assert.deepEqual(sb.pages, [1, 2]);
  assert.equal(users.length, 201);
  assert.equal(users.at(-1).id, '200');
  assert.equal(users.at(-1).last_sign_in_at, null);
});

test('bir sonraki sayfada hata olursa yanıltıcı eksik kullanıcı listesi döndürmez', async () => {
  const authUsers = Array.from({ length: 200 }, (_, index) => ({ id: String(index) }));
  await assert.rejects(listManagedUsers(client(authUsers, [], 2)), /Auth servisi kullanılamıyor/);
});

test('profil sorgusu başarısızsa giriş kaydı yokmuş gibi göstermez', async () => {
  const sb = client([{ id: 'one' }], []);
  sb.from = () => ({ select: () => ({ in: async () => ({ data: null, error: new Error('Profil hatası') }) }) });
  await assert.rejects(listManagedUsers(sb), /Profil hatası/);
});

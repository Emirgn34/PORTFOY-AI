/**
 * Admin paneli — yalnızca rolü 'admin' olan kullanıcıya görünür (rota App'te
 * korunur). Yeni kullanıcı oluşturma, listeleme ve silme.
 */
import { useEffect, useMemo, useState } from 'react';
import { UserPlus, Trash2, Shield, User as UserIcon, Loader2, RefreshCw } from 'lucide-react';
import { listUsers, createUser, deleteUser } from '../services/admin.js';
import { useAuth } from '../contexts/AuthContext.jsx';

const dateFormat = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul',
});

function UserDate({ value, emptyLabel = 'Bilgi alınamadı' }) {
  if (value == null) return <span>{value === null ? emptyLabel : 'Bilgi alınamadı'}</span>;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <span>Bilgi alınamadı</span>;
  return <time dateTime={date.toISOString()}>{dateFormat.format(date)}</time>;
}

export default function AdminPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState('last-sign-in');
  const orderedUsers = useMemo(() => [...(users ?? [])].sort((a, b) => {
    if (sort === 'username') return a.username.localeCompare(b.username, 'tr');
    const field = sort === 'created' ? 'created_at' : 'last_sign_in_at';
    return (Date.parse(b[field]) || 0) - (Date.parse(a[field]) || 0) || a.username.localeCompare(b.username, 'tr');
  }), [users, sort]);
  const now = Date.now();
  const recentCount = users?.filter((u) => {
    const timestamp = Date.parse(u.last_sign_in_at);
    return timestamp <= now && timestamp >= now - 7 * 24 * 60 * 60 * 1000;
  }).length;
  const neverCount = users?.filter((u) => u.last_sign_in_at === null).length;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formOk, setFormOk] = useState(null);

  async function refresh() {
    setLoadError(null);
    setRefreshing(true);
    try {
      setUsers(await listUsers());
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setFormError(null);
    setFormOk(null);
    try {
      await createUser({ username, password, role });
      setFormOk(`"${username.trim().toLowerCase()}" kullanıcısı oluşturuldu.`);
      setUsername('');
      setPassword('');
      setRole('user');
      await refresh();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(u) {
    if (!window.confirm(`"${u.username}" kullanıcısı silinsin mi? Bu işlem geri alınamaz.`)) return;
    try {
      await deleteUser(u.id);
      await refresh();
    } catch (err) {
      setLoadError(err.message);
    }
  }

  return (
    <div data-tour="admin-panel" className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-ink">Kullanıcı Yönetimi</h1>
        <p className="mt-1 text-sm text-slate-500">
          Yeni kullanıcı oluştur, mevcut kullanıcıları görüntüle veya kaldır. Yalnızca yöneticiler bu sayfayı görür.
        </p>
      </div>

      {users !== null && (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ['Toplam kullanıcı', users.length],
            ['Son 7 günde giriş yapan', recentCount],
            ['Hiç giriş yapmayan', neverCount],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-navy-700 bg-navy-900 p-4">
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Yeni kullanıcı formu */}
      <form onSubmit={handleCreate} className="space-y-4 rounded-2xl border border-navy-700/60 bg-navy-900 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <UserPlus size={16} className="text-accent-soft" />
          Yeni Kullanıcı Ekle
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <label htmlFor="new-username" className="mb-1.5 block text-xs font-medium text-slate-400">
              Kullanıcı Adı
            </label>
            <input
              id="new-username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2.5 text-sm text-ink placeholder-slate-600 outline-none focus:border-accent/60"
              placeholder="kullanici"
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_.-]+"
              required
            />
          </div>
          <div className="sm:col-span-1">
            <label htmlFor="new-password" className="mb-1.5 block text-xs font-medium text-slate-400">
              Parola
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2.5 text-sm text-ink placeholder-slate-600 outline-none focus:border-accent/60"
              placeholder="en az 6 karakter"
              minLength={6}
              maxLength={128}
              required
            />
          </div>
          <div className="sm:col-span-1">
            <label htmlFor="new-role" className="mb-1.5 block text-xs font-medium text-slate-400">
              Rol
            </label>
            <select
              id="new-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2.5 text-sm text-ink outline-none focus:border-accent/60"
            >
              <option value="user">Kullanıcı</option>
              <option value="admin">Yönetici</option>
            </select>
          </div>
        </div>

        {formError && (
          <p className="rounded-lg border border-loss/30 bg-loss/10 px-3 py-2 text-xs text-loss">{formError}</p>
        )}
        {formOk && (
          <p className="rounded-lg border border-gain/30 bg-gain/10 px-3 py-2 text-xs text-gain">{formOk}</p>
        )}

        <button
          type="submit"
          disabled={creating}
          className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {creating ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
          {creating ? 'Oluşturuluyor…' : 'Kullanıcı Oluştur'}
        </button>
      </form>

      {/* Kullanıcı listesi */}
      <div className="rounded-2xl border border-navy-700/60 bg-navy-900 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Kullanıcılar</h2>
          <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Kullanıcı sıralaması"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-lg border border-navy-700 bg-navy-950 px-2 py-2 text-xs text-slate-300"
          >
            <option value="last-sign-in">Son girişe göre</option>
            <option value="created">Yeni oluşturulana göre</option>
            <option value="username">Kullanıcı adına göre</option>
          </select>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-md px-2 py-2 text-xs text-slate-400 hover:bg-navy-800 hover:text-slate-200 disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Yenileniyor…' : 'Yenile'}
          </button>
          </div>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-slate-500">
          Tarihler Türkiye saatine göredir (TSİ). Son giriş, son başarılı oturum açma zamanıdır;
          ziyaret sayısını veya şu anda çevrimiçi olma durumunu göstermez.
        </p>

        {loadError && (
          <p role="alert" className="mb-3 rounded-lg border border-loss/30 bg-loss/10 px-3 py-2 text-xs text-loss">
            {loadError}{users !== null && ' Son alınan bilgiler gösteriliyor.'}
          </p>
        )}

        {users === null && loadError ? null : users === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Yükleniyor…
          </div>
        ) : users.length === 0 ? (
          <p className="py-6 text-sm text-slate-500">Henüz kullanıcı yok.</p>
        ) : (
          <ul className="divide-y divide-navy-700/50">
            {orderedUsers.map((u) => {
              const isSelf = u.id === user?.id;
              const isAdmin = u.role === 'admin';
              return (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        isAdmin ? 'bg-accent/20 text-accent-soft' : 'bg-navy-800 text-slate-400'
                      }`}
                    >
                      {isAdmin ? <Shield size={15} /> : <UserIcon size={15} />}
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-ink">
                        {u.username}
                        {isSelf && <span className="ml-2 text-[11px] text-slate-500">(sen)</span>}
                      </p>
                      <p className="text-[11px] text-slate-500">{isAdmin ? 'Yönetici' : 'Kullanıcı'}</p>
                      <dl className="mt-2 space-y-1 text-xs">
                        <div className="flex flex-wrap gap-x-2">
                          <dt className="text-slate-500">Son giriş:</dt>
                          <dd className={u.last_sign_in_at === null ? 'text-amber-400' : 'font-medium text-slate-300'}>
                            <UserDate value={u.last_sign_in_at} emptyLabel="Henüz giriş yapmadı" />
                          </dd>
                        </div>
                        <div className="flex flex-wrap gap-x-2">
                          <dt className="text-slate-500">Kayıt tarihi:</dt>
                          <dd className="text-slate-400"><UserDate value={u.created_at} /></dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                  {!isSelf && (
                    <button
                      type="button"
                      onClick={() => handleDelete(u)}
                      className="flex items-center gap-1.5 rounded-md border border-loss/30 px-2.5 py-1.5 text-xs text-loss transition-colors hover:bg-loss/10"
                    >
                      <Trash2 size={13} /> Sil
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

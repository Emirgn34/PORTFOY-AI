/**
 * Admin paneli — yalnızca rolü 'admin' olan kullanıcıya görünür (rota App'te
 * korunur). Yeni kullanıcı oluşturma, listeleme ve silme.
 */
import { useEffect, useState } from 'react';
import { UserPlus, Trash2, Shield, User as UserIcon, Loader2, RefreshCw } from 'lucide-react';
import { listUsers, createUser, deleteUser } from '../services/admin.js';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function AdminPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formOk, setFormOk] = useState(null);

  async function refresh() {
    setLoadError(null);
    try {
      setUsers(await listUsers());
    } catch (err) {
      setLoadError(err.message);
      setUsers([]);
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
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-white">Kullanıcı Yönetimi</h1>
        <p className="mt-1 text-sm text-slate-500">
          Yeni kullanıcı oluştur, mevcut kullanıcıları görüntüle veya kaldır. Yalnızca yöneticiler bu sayfayı görür.
        </p>
      </div>

      {/* Yeni kullanıcı formu */}
      <form onSubmit={handleCreate} className="space-y-4 rounded-2xl border border-navy-700/60 bg-navy-900 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
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
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-accent/60"
              placeholder="kullanici"
              required
            />
          </div>
          <div className="sm:col-span-1">
            <label htmlFor="new-password" className="mb-1.5 block text-xs font-medium text-slate-400">
              Parola
            </label>
            <input
              id="new-password"
              type="text"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-accent/60"
              placeholder="en az 6 karakter"
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
              className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2.5 text-sm text-white outline-none focus:border-accent/60"
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
          className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {creating ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
          {creating ? 'Oluşturuluyor…' : 'Kullanıcı Oluştur'}
        </button>
      </form>

      {/* Kullanıcı listesi */}
      <div className="rounded-2xl border border-navy-700/60 bg-navy-900 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Kullanıcılar</h2>
          <button
            type="button"
            onClick={refresh}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-navy-800 hover:text-slate-200"
          >
            <RefreshCw size={13} /> Yenile
          </button>
        </div>

        {loadError && (
          <p className="mb-3 rounded-lg border border-loss/30 bg-loss/10 px-3 py-2 text-xs text-loss">{loadError}</p>
        )}

        {users === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Yükleniyor…
          </div>
        ) : users.length === 0 ? (
          <p className="py-6 text-sm text-slate-500">Henüz kullanıcı yok.</p>
        ) : (
          <ul className="divide-y divide-navy-700/50">
            {users.map((u) => {
              const isSelf = u.id === user?.id;
              const isAdmin = u.role === 'admin';
              return (
                <li key={u.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                        isAdmin ? 'bg-accent/20 text-accent-soft' : 'bg-navy-800 text-slate-400'
                      }`}
                    >
                      {isAdmin ? <Shield size={15} /> : <UserIcon size={15} />}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-white">
                        {u.username}
                        {isSelf && <span className="ml-2 text-[11px] text-slate-500">(sen)</span>}
                      </p>
                      <p className="text-[11px] text-slate-500">{isAdmin ? 'Yönetici' : 'Kullanıcı'}</p>
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

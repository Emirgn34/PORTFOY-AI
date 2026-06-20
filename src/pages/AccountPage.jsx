/**
 * Hesabım — her kullanıcının kendi hesap ayarlarını yönettiği sayfa.
 * Kullanıcı adı ve rol (salt okunur) gösterilir; kullanıcı kendi parolasını
 * değiştirebilir. (Yönetici işlemleri ayrı "Kullanıcı Yönetimi" sayfasındadır.)
 */
import { useState } from 'react';
import { User as UserIcon, Shield, Lock, Loader2, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { updatePassword, signOut } from '../services/auth.js';

export default function AccountPage() {
  const { username, isAdmin } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setOk(false);
    if (password.length < 6) {
      setError('Parola en az 6 karakter olmalı.');
      return;
    }
    if (password !== confirm) {
      setError('Parolalar eşleşmiyor.');
      return;
    }
    setSaving(true);
    const { error: err } = await updatePassword(password);
    setSaving(false);
    if (err) {
      setError('Parola güncellenemedi. Lütfen tekrar deneyin.');
      return;
    }
    setOk(true);
    setPassword('');
    setConfirm('');
  }

  const inputClass =
    'w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2.5 text-sm text-ink placeholder-slate-600 outline-none focus:border-accent/60';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-ink">Hesabım</h1>
        <p className="mt-1 text-sm text-slate-500">Hesap bilgilerini görüntüle ve parolanı değiştir.</p>
      </div>

      {/* Hesap bilgileri (salt okunur) */}
      <div className="rounded-2xl border border-navy-700/60 bg-navy-900 p-5">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-11 w-11 items-center justify-center rounded-xl text-lg font-bold ${
              isAdmin ? 'bg-accent/20 text-accent-soft' : 'bg-navy-800 text-slate-300'
            }`}
          >
            {(username ?? '?').slice(0, 1).toUpperCase()}
          </span>
          <div>
            <p className="text-base font-semibold text-ink">{username}</p>
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              {isAdmin ? <Shield size={12} /> : <UserIcon size={12} />}
              {isAdmin ? 'Yönetici' : 'Kullanıcı'}
            </p>
          </div>
        </div>
      </div>

      {/* Parola değiştirme */}
      <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-navy-700/60 bg-navy-900 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Lock size={16} className="text-accent-soft" />
          Parolayı Değiştir
        </div>

        <div>
          <label htmlFor="new-pass" className="mb-1.5 block text-xs font-medium text-slate-400">
            Yeni Parola
          </label>
          <input
            id="new-pass"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder="en az 6 karakter"
          />
        </div>
        <div>
          <label htmlFor="confirm-pass" className="mb-1.5 block text-xs font-medium text-slate-400">
            Yeni Parola (Tekrar)
          </label>
          <input
            id="confirm-pass"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
            placeholder="parolayı tekrar gir"
          />
        </div>

        {error && (
          <p className="rounded-lg border border-loss/30 bg-loss/10 px-3 py-2 text-xs text-loss">{error}</p>
        )}
        {ok && (
          <p className="rounded-lg border border-gain/30 bg-gain/10 px-3 py-2 text-xs text-gain">
            Parolan güncellendi.
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          {saving ? 'Kaydediliyor…' : 'Parolayı Güncelle'}
        </button>
      </form>

      {/* Çıkış */}
      <button
        type="button"
        onClick={() => signOut()}
        className="flex items-center gap-2 rounded-lg border border-navy-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-navy-800 hover:text-ink"
      >
        <LogOut size={16} />
        Çıkış Yap
      </button>
    </div>
  );
}

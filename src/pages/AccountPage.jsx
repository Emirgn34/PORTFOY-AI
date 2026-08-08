/** Hesabım — kullanıcı adı ve parola ayarları. */
import { useEffect, useState } from 'react';
import { CheckCircle2, User as UserIcon, Shield, Lock, Loader2, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { signOut, updatePassword, updateUsername } from '../services/auth.js';

const inputClass =
  'w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2.5 text-sm text-ink placeholder-slate-600 outline-none focus:border-accent/60';

export default function AccountPage() {
  const { username, isAdmin, refreshProfile } = useAuth();

  const [usernameValue, setUsernameValue] = useState(username ?? '');
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameError, setUsernameError] = useState(null);
  const [usernameOk, setUsernameOk] = useState(false);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState(null);
  const [passwordOk, setPasswordOk] = useState(false);

  useEffect(() => {
    setUsernameValue(username ?? '');
  }, [username]);

  async function handleUsernameSubmit(e) {
    e.preventDefault();
    setUsernameError(null);
    setUsernameOk(false);
    const normalized = usernameValue.trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,32}$/.test(normalized)) {
      setUsernameError('Kullanıcı adı 3-32 karakter olmalı; harf, rakam, nokta, alt çizgi veya tire kullanabilirsiniz.');
      return;
    }

    setUsernameSaving(true);
    const result = await updateUsername(normalized);
    if (result.error) {
      setUsernameError(result.error.message);
      setUsernameSaving(false);
      return;
    }

    await refreshProfile();
    setUsernameValue(result.username);
    setUsernameOk(true);
    setUsernameSaving(false);
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordOk(false);
    if (password.length < 6) {
      setPasswordError('Parola en az 6 karakter olmalı.');
      return;
    }
    if (password.length > 128) {
      setPasswordError('Parola en fazla 128 karakter olabilir.');
      return;
    }
    if (password !== confirm) {
      setPasswordError('Parolalar eşleşmiyor.');
      return;
    }

    setPasswordSaving(true);
    const { error } = await updatePassword(password);
    setPasswordSaving(false);
    if (error) {
      setPasswordError(error.message || 'Parola güncellenemedi. Lütfen tekrar deneyin.');
      return;
    }
    setPasswordOk(true);
    setPassword('');
    setConfirm('');
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-ink">Hesabım</h1>
        <p className="mt-1 text-sm text-slate-500">Kullanıcı adınızı ve parolanızı güvenli biçimde değiştirin.</p>
      </div>

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

      <form onSubmit={handleUsernameSubmit} className="space-y-4 rounded-2xl border border-navy-700/60 bg-navy-900 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <UserIcon size={16} className="text-accent-soft" />
          Kullanıcı Adını Değiştir
        </div>
        <div>
          <label htmlFor="account-username" className="mb-1.5 block text-xs font-medium text-slate-400">
            Yeni Kullanıcı Adı
          </label>
          <input
            id="account-username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={usernameValue}
            onChange={(e) => setUsernameValue(e.target.value)}
            className={inputClass}
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9_.-]+"
            required
          />
          <p className="mt-1.5 text-[11px] text-slate-600">
            Değişiklikten sonraki girişlerinizde yeni kullanıcı adınızı kullanın.
          </p>
        </div>

        {usernameError && <Alert tone="error">{usernameError}</Alert>}
        {usernameOk && <Alert tone="success">Kullanıcı adınız güncellendi.</Alert>}

        <button
          type="submit"
          disabled={usernameSaving || usernameValue.trim().toLowerCase() === username}
          className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {usernameSaving && <Loader2 size={16} className="animate-spin" />}
          {usernameSaving ? 'Güncelleniyor…' : 'Kullanıcı Adını Güncelle'}
        </button>
      </form>

      <form onSubmit={handlePasswordSubmit} className="space-y-4 rounded-2xl border border-navy-700/60 bg-navy-900 p-5">
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
            minLength={6}
            maxLength={128}
            required
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
            minLength={6}
            maxLength={128}
            required
          />
        </div>

        {passwordError && <Alert tone="error">{passwordError}</Alert>}
        {passwordOk && <Alert tone="success">Parolanız güncellendi.</Alert>}

        <button
          type="submit"
          disabled={passwordSaving}
          className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {passwordSaving && <Loader2 size={16} className="animate-spin" />}
          {passwordSaving ? 'Kaydediliyor…' : 'Parolayı Güncelle'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => signOut()}
        className="flex items-center gap-2 rounded-lg border border-navy-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-navy-800 hover:text-ink"
      >
        <LogOut size={16} /> Çıkış Yap
      </button>
    </div>
  );
}

function Alert({ tone, children }) {
  const success = tone === 'success';
  return (
    <p
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
        success ? 'border-gain/30 bg-gain/10 text-gain' : 'border-loss/30 bg-loss/10 text-loss'
      }`}
    >
      {success && <CheckCircle2 size={14} />}
      {children}
    </p>
  );
}

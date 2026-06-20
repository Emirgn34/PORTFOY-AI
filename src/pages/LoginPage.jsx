/**
 * Giriş ekranı. Site açılınca giriş yapılmadan hiçbir sayfa görünmez.
 * Kullanıcı adı + parola alır; arka planda Supabase Auth ile doğrular.
 */
import { useState } from 'react';
import { Lock, User, Loader2 } from 'lucide-react';
import { signIn } from '../services/auth.js';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    const { error } = await signIn(username, password);
    if (error) {
      setError('Kullanıcı adı veya parola hatalı.');
      setSubmitting(false);
    }
    // Başarılıysa AuthContext oturum değişimini yakalar ve uygulama açılır.
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/logo.png" alt="PortföyAI logosu" className="mb-3 h-16 w-16 rounded-full object-contain" />
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            Portföy<span className="text-accent-soft">AI</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">Devam etmek için giriş yapın</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-navy-700/60 bg-navy-900 p-6"
        >
          <div>
            <label htmlFor="username" className="mb-1.5 block text-xs font-medium text-slate-400">
              Kullanıcı Adı
            </label>
            <div className="relative">
              <User size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-navy-700 bg-navy-950 py-2.5 pl-9 pr-3 text-sm text-ink placeholder-slate-600 outline-none focus:border-accent/60"
                placeholder="kullanici"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-slate-400">
              Parola
            </label>
            <div className="relative">
              <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-navy-700 bg-navy-950 py-2.5 pl-9 pr-3 text-sm text-ink placeholder-slate-600 outline-none focus:border-accent/60"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-loss/30 bg-loss/10 px-3 py-2 text-xs text-loss">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <Loader2 size={16} className="animate-spin" />}
            {submitting ? 'Giriş yapılıyor…' : 'Giriş Yap'}
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-600">
          Hesabın yoksa yöneticinden kullanıcı adı ve parola iste.
        </p>
      </div>
    </div>
  );
}

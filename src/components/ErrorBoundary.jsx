import { Component } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

/**
 * Sayfa içeriğini saran hata sınırı.
 *
 * React'te render sırasında fırlayan bir hata yakalanmazsa TÜM ağaç unmount
 * olur ve kullanıcı bomboş beyaz ekran görür (menü dahil) — sayfaya
 * "girilemiyormuş" gibi hissettirir. Burası hatayı yakalayıp yalnızca içerik
 * alanında okunur bir kart gösterir; kenar çubuğu ve menü çalışmaya devam eder.
 *
 * Layout içinde `key={pathname}` ile kullanılır: başka bir sayfaya geçilince
 * sınır sıfırlanır, hatalı sayfa diğerlerini kilitlemez.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Tarayıcı konsoluna bırak — canlıda teşhis için tek ipucu bu.
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="w-full max-w-lg rounded-xl border border-loss/30 bg-navy-900 p-6 text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-loss" />
          <h2 className="text-base font-semibold text-ink">Bu sayfa açılırken bir hata oluştu</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Uygulamanın geri kalanı çalışıyor — menüden başka bir sayfaya geçebilirsin.
          </p>

          <p className="mt-4 break-words rounded-lg border border-navy-700 bg-navy-850 px-3 py-2 text-left font-mono text-[11px] text-slate-400">
            {error.message || String(error)}
          </p>

          <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="flex items-center justify-center gap-2 rounded-lg border border-navy-700 px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:bg-navy-800 hover:text-ink"
            >
              <RotateCcw size={15} />
              Tekrar dene
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-soft"
            >
              <RefreshCw size={15} />
              Sayfayı yenile
            </button>
          </div>
        </div>
      </div>
    );
  }
}

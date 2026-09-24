import { useEffect, useState } from 'react';
import { Loader2, Play, Plus, X } from 'lucide-react';
import { MODEL_PORTFOLIO_PROFILES } from '../utils/modelPortfolioCore.js';
import { automationRequest } from '../services/automation.js';
import PortfolioSet from '../components/PortfolioSet.jsx';

export default function ValuePortfoliosPage() {
  const [data, setData] = useState(null);
  const [preferences, setPreferences] = useState({});
  const [profile, setProfile] = useState(MODEL_PORTFOLIO_PROFILES[0].slug);
  const [symbol, setSymbol] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [versionId, setVersionId] = useState('');
  useEffect(() => {
    let active = true, initialized = false, loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const next = await automationRequest('value');
        if (!active) return;
        setData(next);
        if (!initialized) { setPreferences(next.job?.preferences ?? next.versions[0]?.preferences ?? {}); initialized = true; }
      } catch (e) { if (active) setError(e.message); }
      finally { loading = false; }
    }
    load(); const timer = setInterval(load, 10000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const pending = ['queued','running'].includes(data?.job?.status);
  const current = data?.versions?.find((v) => v.id === versionId) ?? data?.versions?.[0];
  function edit(key, value, remove = false) {
    setPreferences((previous) => {
      const settings = previous[profile] ?? { include: [], exclude: [] };
      return { ...previous, [profile]: { ...settings, [key]: remove ? settings[key].filter((s) => s !== value) : [...new Set([...(settings[key] ?? []), value])] } };
    });
  }
  async function generate() {
    setBusy(true); setError('');
    try {
      await automationRequest('value', { method: 'POST', body: { preferences } });
      setData(await automationRequest('value')); setVersionId('');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5">
    <section className="rounded-xl border border-navy-700 bg-navy-900 p-5 space-y-3">
      <h2 className="text-xl font-semibold text-ink">Manuel Değer Portföyleri <span className="text-sm text-accent">ABD</span></h2>
      <p className="max-w-3xl text-sm text-slate-400">Düğmeye bastığında güncel ABD aday havuzu yeniden analiz edilir. Mevcut algoritmaya sektör içi ucuzluk filtresi eklenir ve dört ayrı sepet kaydedilir. Aylık hazır portföylerin değişmez.</p>
      <p className="text-xs text-slate-500">F/K ve PD/DD sektör medyanına göre en az %10 iskonto, pozitif kârlılık ve büyüme kontrolü. En az 5 şirketle karşılaştırma; veri eksikse otomatik seçim yapılmaz. Manuel eklemeler bu eşiklerden bağımsız işaretlenir.</p>
      <button onClick={generate} disabled={busy || pending || !data} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent disabled:opacity-50">
        {busy || pending ? <Loader2 size={17} className="animate-spin" /> : <Play size={17} />}{pending ? data.job.status === 'queued' ? 'Analiz sırada' : 'Hisseler yeniden analiz ediliyor…' : 'Algoritmayı çalıştır ve portföyleri oluştur'}
      </button>
      {pending && <p role="status" className="text-xs text-slate-400">İstek kaydedildi. Arka plan çalışanı aldığında analiz başlar; birkaç dakika sürebilir. Sayfayı kapatabilirsin.</p>}
      {(error || data?.job?.error) && <p role="alert" className="text-sm text-loss">{error || data.job.error}</p>}
    </section>
    <section className="rounded-xl border border-navy-700 bg-navy-900 p-5 space-y-4">
      <h3 className="font-semibold text-ink">Hisse ekle / çıkar</h3>
      <p className="text-xs text-slate-400">Tercihler sonraki çalıştırmada uygulanır ve hesabına kaydedilir. Çıkardığın hisse otomatik seçimde de kullanılmaz.</p>
      <label className="block text-sm text-slate-400">Sepet<select aria-label="Düzenlenecek sepet" value={profile} onChange={(e) => setProfile(e.target.value)} className="ml-3 rounded-lg border border-navy-700 bg-navy-850 p-2 text-ink">{MODEL_PORTFOLIO_PROFILES.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></label>
      <form onSubmit={(e) => { e.preventDefault(); if (symbol.trim()) { edit('include', symbol.trim().toUpperCase()); setSymbol(''); } }} className="flex flex-wrap gap-2">
        <input aria-label="ABD hisse kodu" placeholder="Örn. AAPL" maxLength={10} pattern="[A-Za-z][A-Za-z0-9-]{0,9}" value={symbol} onChange={(e) => setSymbol(e.target.value)} className="rounded-lg border border-navy-700 bg-navy-850 p-2 text-ink" />
        <button disabled={!symbol.trim() || pending} className="flex items-center gap-1 rounded-lg border border-accent px-3 py-2 text-sm text-accent"><Plus size={15} />Ekle</button>
        <button type="button" disabled={!symbol.trim() || pending} onClick={() => { edit('exclude', symbol.trim().toUpperCase()); setSymbol(''); }} className="rounded-lg border border-navy-700 px-3 py-2 text-sm text-slate-300">Seçimden çıkar</button>
      </form>
      {['include','exclude'].map((key) => <div key={key} className="flex flex-wrap items-center gap-2 text-xs text-slate-400"><span>{key === 'include' ? 'Eklenecek:' : 'Hariç tutulacak:'}</span>{(preferences[profile]?.[key] ?? []).map((ticker) => <button key={ticker} onClick={() => edit(key,ticker,true)} className="inline-flex items-center gap-1 rounded-full bg-navy-800 px-3 py-1" aria-label={`${ticker} tercihini kaldır`}>{ticker}<X size={12} /></button>)}</div>)}
    </section>
    {current ? <><label className="flex gap-3 text-sm text-slate-400">Kayıtlı sürüm<select aria-label="Kayıtlı sürüm" value={current.id} onChange={(e) => setVersionId(e.target.value)} className="rounded-lg border border-navy-700 bg-navy-900 p-2">{data.versions.map((v) => <option key={v.id} value={v.id}>{new Date(v.created_at).toLocaleString('tr-TR')}</option>)}</select></label><PortfolioSet portfolios={current.portfolios} /></>
      : <p className="rounded-xl border border-dashed border-navy-700 p-8 text-center text-sm text-slate-400">İlk analizi çalıştırdığında dört sepet burada görünecek.</p>}
  </div>;
}

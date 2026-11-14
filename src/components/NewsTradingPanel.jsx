import { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import { newsRequest } from '../services/news.js';
import { calculateNewsPosition } from '../utils/newsTrading.js';
import { safeNewsUrl } from '../utils/newsUrls.js';

const inputClass = 'w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 text-sm text-ink';
const number = (value) => Number(value).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
const money = (value, currency) => `${number(value)} ${currency || ''}`.trim();

export default function NewsTradingPanel({ initialSymbol = '', autoLoad = false, onArticles }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [capital, setCapital] = useState('');
  const [risk, setRisk] = useState('0.5');
  const [cap, setCap] = useState('5');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [costBps, setCostBps] = useState('20');
  const controllerRef = useRef(null);
  const generationRef = useRef(0);
  const articlesRef = useRef(onArticles);
  articlesRef.current = onArticles;

  async function analyze(targetSymbol = symbol, targetQuery = query) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    setLoading(true); setError(''); setResult(null);
    try {
      const response = await newsRequest('implications', { symbol: targetSymbol.trim().toUpperCase(), query: targetQuery.trim(), signal: controller.signal });
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setResult(response);
      setEntry(response.analysis?.priceContext?.available ? String(response.analysis.priceContext.price.toFixed(2)) : '');
      setStop(response.analysis?.priceContext?.illustrativeStop ? String(response.analysis.priceContext.illustrativeStop.toFixed(2)) : '');
      articlesRef.current?.(response.articles ?? []);
    } catch (err) { if (!controller.signal.aborted && generation === generationRef.current) setError(err.message || 'Haber analizi alınamadı.'); }
    finally { if (!controller.signal.aborted && generation === generationRef.current) setLoading(false); }
  }

  useEffect(() => {
    controllerRef.current?.abort();
    ++generationRef.current;
    setSymbol(initialSymbol); setResult(null); setError(''); setLoading(false);
    if (autoLoad && initialSymbol) void analyze(initialSymbol, '');
    return () => { ++generationRef.current; controllerRef.current?.abort(); };
    // The selected article/ticker controls this panel, input edits do not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSymbol, autoLoad]);

  const analysis = result?.analysis;
  const prices = analysis?.priceContext;
  const size = prices?.available && analysis?.evidence?.length ? calculateNewsPosition({ capital, riskPercent: risk, allocationPercent: cap, entry, stop, costBps }) : null;
  const recommended = analysis?.bias === 'positive' ? size?.units ?? null : analysis ? 0 : null;
  const changeTopic = (setter) => (event) => {
    controllerRef.current?.abort(); ++generationRef.current;
    setResult(null); setError(''); setLoading(false); setter(event.target.value);
  };

  return <section aria-label="Haberden işlem planı" className="space-y-4 rounded-xl border border-accent/25 bg-navy-900 p-4">
    <div>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><ArrowRightLeft size={16} className="text-accent" />News to Trading · Haberlerden işlem çıkarımı</h2>
      <p className="mt-1 text-xs text-slate-400">Şirket veya sektörün son haberleri, kısa ve uzun vadeli etkiler, fiyat senaryoları ve risk bütçesi.</p>
    </div>
    <form onSubmit={(e) => { e.preventDefault(); void analyze(); }} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
      <label className="space-y-1 text-xs text-slate-400">Şirket veya sektör<input aria-label="Analiz edilecek şirket veya sektör" value={query} onChange={changeTopic(setQuery)} placeholder="Örn. yarı iletkenler, Apple" maxLength={120} className={inputClass} /></label>
      <label className="space-y-1 text-xs text-slate-400">Fiyat için hisse kodu<input aria-label="Analiz hisse kodu" value={symbol} onChange={changeTopic(setSymbol)} placeholder="NVDA veya THYAO.IS" maxLength={15} className={inputClass} /></label>
      <button type="submit" disabled={loading || (!symbol.trim() && query.trim().length < 2)} className="self-end rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50">{loading ? <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" />İnceleniyor</span> : 'Haberleri işlemlere dönüştür'}</button>
    </form>
    {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    {analysis && <div className="space-y-4">
      <p className="text-sm leading-relaxed text-slate-300">{analysis.summary}</p>
      {!!analysis.evidence?.length && <ul className="space-y-2 text-xs text-slate-300">{analysis.evidence.map((item) => <li key={item.id || item.link}>
        <a href={safeNewsUrl(item.link) || undefined} target="_blank" rel="noopener noreferrer" className="text-accent-soft hover:underline">{item.title}</a>
        <span className="ml-2 text-slate-500">{item.publisher} · {new Date(item.publishedAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })} TSİ</span>
      </li>)}</ul>}
      {analysis.themes?.map((theme) => <div key={theme.label} className="rounded-lg border border-navy-700 p-3 text-xs leading-relaxed">
        <h3 className="mb-2 font-semibold text-ink">{theme.label}</h3>
        <p className="text-slate-300"><strong>Kısa vade (1–5 işlem günü): </strong>{theme.shortTerm}</p>
        <p className="mt-2 text-slate-300"><strong>Uzun vade (3–12 ay): </strong>{theme.longTerm}</p>
      </div>)}
      <div className="space-y-2 text-xs text-slate-400">
        <h3 className="font-semibold text-ink">Koşullu fiyat dalgalanma aralıkları</h3>
        {prices?.available ? <>
          <p>Referans kapanış: {money(prices.price, prices.currency)} · {new Date(prices.asOf).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })} · {prices.sampleSessions} günlük getiri.</p>
          <div className="grid gap-2 sm:grid-cols-2">{prices.ranges.map((range) => <p key={range.sessions} className="rounded-lg bg-navy-800 p-3"><strong className="block text-slate-300">{range.horizon}</strong>{money(range.low, prices.currency)} – {money(range.high, prices.currency)} ({number(range.downsidePercent)}% / +{number(range.upsidePercent)}%)</p>)}</div>
          <p>{prices.method}</p>
        </> : <p>{prices?.reason}</p>}
      </div>
      <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-relaxed text-amber-200">{analysis.condition}</p>
      {prices?.available && !!analysis.evidence?.length && <div className="space-y-3 rounded-lg border border-navy-700 p-3">
        <h3 className="text-sm font-semibold text-ink">Örnek uzun pozisyon boyutu</h3>
        <p className="text-xs text-slate-400">Tutarları {prices.currency || 'hissenin para birimi'} cinsinden girin. Sermaye × risk bütçesi / (giriş − zarar kes + tahmini maliyet); tahsis üst sınırı ayrıca uygulanır.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[
          ['Sermaye', capital, setCapital, '0.01', undefined], ['Kayıp bütçesi (%)', risk, setRisk, '0.1', 5], ['Tahsis üst sınırı (%)', cap, setCap, '1', 100],
          ['Örnek giriş', entry, setEntry, '0.01', undefined], ['Zarar kes', stop, setStop, '0.01', undefined], ['Toplam maliyet (baz puan)', costBps, setCostBps, '1', 1000],
        ].map(([label, value, setter, step, max]) => <label key={label} className="space-y-1 text-xs text-slate-400">{label}<input type="number" aria-label={label} min="0" max={max} step={step} value={value} onChange={(e) => setter(e.target.value)} className={inputClass} /></label>)}</div>
        {size ? <p role="status" className="text-xs text-slate-300">Risk sınırına göre hesap: {size.units} adet · {money(size.positionValue, prices.currency)} · Sermayenin %{number(size.allocationPercent)} kadarı · Zarar kes gerçekleşirse tahmini kayıp {money(size.estimatedLoss, prices.currency)}. Haber teyidi sonrası değerlendirilebilecek adet: {recommended}.</p>
          : <p className="text-xs text-slate-500">Hesap için sermaye, geçerli giriş ve girişten düşük zarar kes girin. Kayıp bütçesi en çok %5 olabilir.</p>}
        {prices.stopMethod && <p className="text-xs text-slate-500">{prices.stopMethod}</p>}
        <p className="text-xs text-slate-500">Zarar kes boşluklu açılışta garanti edilmez. Gerçek maliyetleri girin; bu panel emir göndermez.</p>
      </div>}
      {result.warnings?.map((warning) => <p key={warning} className="text-xs text-amber-300">{warning}</p>)}
    </div>}
  </section>;
}

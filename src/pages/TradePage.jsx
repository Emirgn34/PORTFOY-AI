import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, Bell, Clock3, Info, Loader2, ShieldAlert, X } from 'lucide-react';
import { tradeRequest } from '../services/trade.js';
import NotificationSettings from '../components/NotificationSettings.jsx';

const PHONE_TOPICS = ['trade'];
const RISK_LABELS = { lower: 'Görece temkinli', medium: 'Dengeli', high: 'Agresif' };
const STATUS_LABELS = { ready: 'Koşullar uygun', watch: 'İzlemede', blocked: 'Veri / koşul bekleniyor' };
const REQUIREMENT_LABELS = { available: 'Hazır', partial: 'Kısmi', missing: 'Eksik' };
const panel = 'rounded-xl border border-navy-700 bg-navy-900 p-5';

function textOf(value) {
  return typeof value === 'string' ? value : value?.text || value?.label || value?.message || value?.title || '';
}
function number(value, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('tr-TR', { maximumFractionDigits: digits }) : '—';
}
function price(value, currency) {
  return `${number(value)} ${currency || ''}`.trim();
}
function date(value) {
  const parsed = new Date(value);
  return value && Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Henüz yok';
}
function duration(hours) {
  return Array.isArray(hours) && hours.length === 2 && hours.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? `${number(hours[0], 1)}–${number(hours[1], 1)} işlem saati` : 'Süre için gün içi veri bekleniyor';
}
/**
 * Tazelik eşikleri SUNUCUDAN okunur (status.quoteMaxAgeMs / barMaxAgeMs) —
 * tek gerçek kaynak server/tradeData.js ve SQL'deki trade_delivery_allowed.
 * Buradaki 15/90/30 sn değerleri sadece ÜST SINIRDIR: sunucu eşiği
 * sıkılaştırabilir, arayüz asla gevşetemez (Math.min bunu garanti eder).
 */
function live(candidate, now, status) {
  const quoteMax = Math.min(15000, Number(status?.quoteMaxAgeMs) || 15000);
  const barMax = Math.min(90000, Number(status?.barMaxAgeMs) || 90000);
  const quality = candidate.dataQuality;
  const quote = Date.parse(quality?.quoteTime);
  const bar = Date.parse(quality?.barTime);
  const created = Date.parse(candidate.createdAt);
  return candidate.status === 'ready' && quality?.realtime === true && quality?.sessionVerified === true
    && quality?.halted === false && Date.parse(candidate.expiresAt) > now
    && created <= now + 2000 && now - created <= 30000
    && quote <= now + 2000 && now - quote <= quoteMax && bar <= now && now - bar <= barMax;
}
function reasons(candidate, key) {
  return (candidate[key] ?? []).map(textOf).filter(Boolean);
}
function safeLink(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}

function TradeContext({ context = {} }) {
  const intelligence = context.intelligence;
  const fundamentals = intelligence?.fundamentals ?? context.candidate?.fundamentals;
  const earnings = intelligence?.earningsDate ?? intelligence?.earnings?.date;
  const news = context.news ?? [];
  return <section className="space-y-4">
    <h3 className="font-semibold text-ink">Haber ve araştırma bağlamı</h3>
    <p className="text-xs leading-relaxed text-slate-400">Haberler ve temel veriler risk bağlamı sağlar; dakikalık giriş sinyali veya garantili fiyat hedefi değildir.</p>
    {news.length > 0 ? <ul className="space-y-3">{news.map((article, index) => <li key={article.url || index} className="rounded-lg border border-navy-700 p-3">{safeLink(article.url ?? article.link) ? <a href={safeLink(article.url ?? article.link)} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-accent underline underline-offset-2">{article.title}</a> : <p className="text-sm text-ink">{article.title}</p>}<p className="mt-1 text-xs text-slate-500">{article.publisher || 'Kaynak haberde'} · {date(article.publishedAt ?? article.published_at)}</p></li>)}</ul> : <p className="text-sm text-slate-400">Güncel haber bağlamı bulunmuyor.</p>}
    <dl className="grid gap-3 rounded-xl bg-navy-850 p-4 text-xs sm:grid-cols-2">
      <div><dt className="text-slate-400">Mevcut fırsat analizi</dt><dd className="mt-1 text-ink">{context.candidate ? `${context.candidate.horizon || 'Kısa vade'} · Skor ${number(context.candidate.score, 0)} (başarı olasılığı değildir)` : 'Bağlam bulunmuyor'}</dd></div>
      <div><dt className="text-slate-400">Bilanço takvimi</dt><dd className="mt-1 text-ink">{earnings ? /^\d{4}-\d{2}-\d{2}$/.test(earnings) ? `${earnings} · Saat bilinmiyor` : date(earnings) : 'Açıklama tarihi doğrulanmamış'}</dd></div>
      <div><dt className="text-slate-400">F/K · İleri F/K · PD/DD</dt><dd className="mt-1 text-ink">{fundamentals ? `${number(fundamentals.trailingPE ?? fundamentals.peRatio)} · ${number(fundamentals.forwardPE ?? fundamentals.forwardPeRatio)} · ${number(fundamentals.priceToBook)}` : 'Temel veri bağlamı bulunmuyor'}</dd></div>
      <div><dt className="text-slate-400">Araştırma kaynağı / zamanı</dt><dd className="mt-1 text-ink">{intelligence?.source || (context.candidate ? 'Mevcut fırsat analizi' : 'Doğrulanmamış')} · {date(intelligence?.fetchedAt ?? context.candidate?.updatedAt)}</dd></div>
    </dl>
    <div><h4 className="mb-2 text-xs font-semibold text-slate-400">Yüksek etkili makro risk penceresi</h4>{(context.macroEvents ?? []).length > 0 ? <ul className="space-y-2 text-sm text-amber-400">{context.macroEvents.map((event, index) => <li key={index}>{event.title || event.name || event.label || 'Makro veri açıklaması'} · {date(event.time ?? event.date ?? event.startsAt)}</li>)}</ul> : <p className="text-xs text-slate-400">Bu analizde risk penceresine düşen kayıt bulunmuyor. Takvim kapsamı ayrıca doğrulanmalı.</p>}</div>
  </section>;
}

function TradeDetail({ candidate, now, status, onClose }) {
  const dialog = useRef(null);
  const closeButton = useRef(null);
  const [capital, setCapital] = useState('');
  const [riskBudget, setRiskBudget] = useState('0.5');
  const actionable = live(candidate, now, status);
  const hasEntry=Number.isFinite(candidate.entry) && candidate.entry>0;
  const hasPlan=candidate.availability!=='research-only' && hasEntry && Number.isFinite(candidate.stopLoss)
    && candidate.stopLoss>0 && candidate.stopLoss<candidate.entry && (candidate.scenarios ?? []).length>0;
  const costBps = candidate.metrics?.roundTripCostBps ?? candidate.metrics?.costBps;
  const hasSpread=Number.isFinite(candidate.metrics?.spreadBps) && candidate.metrics.spreadBps>=0;
  const costPerShare = hasEntry && hasSpread ? Number.isFinite(candidate.metrics?.estimatedCostPerShare)
    ? candidate.metrics.estimatedCostPerShare : Number.isFinite(costBps) ? candidate.entry * (costBps + candidate.metrics.spreadBps) / 10000 : null : null;
  const hasSizingData=hasPlan && Number.isFinite(costPerShare) && costPerShare>=0;
  const lossPerShare = hasSizingData ? candidate.entry - candidate.stopLoss + costPerShare : null;
  const canSize = hasSizingData && Number.isFinite(Number(capital)) && Number(capital) > 0 && Number.isFinite(Number(riskBudget)) && Number(riskBudget) > 0 && Number(riskBudget) <= 5 && lossPerShare>0;
  const quantity = canSize ? Math.max(0, Math.floor(Math.min(Number(capital) / (candidate.entry + costPerShare),
    Number(capital) * Number(riskBudget) / 100 / lossPerShare))) : null;
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    function keydown(event) {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.current.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')].filter((node) => !node.disabled);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-6" onClick={onClose}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="trade-detail-title" onClick={(event) => event.stopPropagation()} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-navy-700 bg-navy-900 shadow-2xl">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-navy-700 bg-navy-900 p-5">
        <div><h2 id="trade-detail-title" className="text-xl font-semibold text-ink">{candidate.symbol} · Trade planı</h2><p className="mt-1 text-sm text-slate-400">{candidate.name} · {duration(candidate.estimatedHours)}</p></div>
        <button ref={closeButton} onClick={onClose} aria-label="Trade detayını kapat" className="rounded-lg p-2 text-slate-400 hover:bg-navy-800"><X size={20} /></button>
      </div>
      <div className="space-y-5 p-5">
        {!actionable && <p role="status" className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-400">{candidate.availability === 'research-only' ? 'Bu kart mevcut fırsat analizinden gelen araştırma adayıdır. Doğrulanmış canlı fiyat ve hacim bağlantısı kurulana kadar gün içi trade sinyali üretilmez.' : candidate.status === 'ready' ? 'Sinyalin süresi doldu. Yeni ve doğrulanmış veri gelene kadar işlem koşulları geçerli değil.' : 'Bu hisse şu an işlem için uygun değil. Aşağıdaki seviyeler inceleme senaryosudur.'}</p>}
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-navy-850 p-4 text-sm sm:grid-cols-3">
          <div><p className="text-slate-400">Referans giriş</p><p className="mt-1 font-semibold tabular-nums text-ink">{price(candidate.entry, candidate.currency)}</p></div>
          <div><p className="text-slate-400">Zarar kes</p><p className="mt-1 font-semibold tabular-nums text-loss">{price(candidate.stopLoss, candidate.currency)}</p></div>
          <div><p className="text-slate-400">Geçerlilik sonu</p><p className="mt-1 text-ink">{hasPlan?date(candidate.expiresAt):'Canlı plan oluşmadı'}</p></div>
        </div>
        <section><h3 className="mb-3 font-semibold text-ink">Hedef ve risk senaryoları</h3>
          <p className="mb-4 text-xs leading-relaxed text-slate-400">Risk etiketleri hedefe ulaşma belirsizliğini karşılaştırır. Daha yakın hedef düşük sermaye kaybı riski garantisi vermez. Süreler oynaklığa dayalı yaklaşık işlem penceresidir; doğrulanmış süre tahmini değildir. Hedefler gerçekleşmeyebilir. Emir gönderilmez.</p>
          {(candidate.scenarios ?? []).length ? <div className="grid gap-3 sm:grid-cols-3">{candidate.scenarios.map((scenario) => <article key={scenario.id || scenario.targetPercent} className={`rounded-xl border p-4 ${scenario.eligible && actionable ? 'border-accent/40 bg-accent/5' : 'border-navy-700 bg-navy-850'}`}>
            <p className="text-xs font-semibold text-slate-400">{RISK_LABELS[scenario.risk] || scenario.label || 'Senaryo'}</p>
            <h4 className="mt-2 text-lg font-semibold tabular-nums text-gain">+%{number(scenario.targetPercent)} hedef</h4>
            <p className="mt-1 text-sm font-medium text-ink">{price(scenario.targetPrice, candidate.currency)} seviyesinde çıkış</p>
            <dl className="mt-4 space-y-2 text-xs"><div className="flex justify-between gap-2"><dt className="text-slate-400">Zarar kes</dt><dd className="text-loss">{price(scenario.stopLoss ?? candidate.stopLoss, candidate.currency)}</dd></div><div className="flex justify-between gap-2"><dt className="text-slate-400">Net getiri / risk</dt><dd className="text-ink">{number(scenario.netRewardRisk)}×</dd></div><div><dt className="text-slate-400">Tahmini süre</dt><dd className="mt-1 text-ink">{duration(scenario.estimatedHours)}</dd></div></dl>
            <p className={`mt-4 text-xs ${scenario.eligible && actionable ? 'text-gain' : 'text-amber-400'}`}>{scenario.eligible && actionable ? 'Veri ve risk koşulları uygun' : 'İşlem koşulları sağlanmıyor'}</p>
          </article>)}</div> : <p className="text-sm text-slate-400">Hedef üretebilmek için doğrulanmış gün içi fiyat, hacim ve oynaklık verisi gerekiyor.</p>}
          <p className="mt-3 text-xs text-slate-500">Gidiş dönüş komisyon / kayma varsayımı: {number(costBps)} baz puan. {Number.isFinite(costPerShare)?<>Spread: {number(candidate.metrics?.spreadBps)} baz puan; hesapta toplam tahmini maliyet {price(costPerShare, candidate.currency)} / adet. Gerçek maliyet farklı olabilir.</>:'Giriş fiyatı ve alış/satış verisi olmadan hisse başına toplam maliyet hesaplanamaz.'}</p>
        </section>
        <section className="rounded-xl border border-navy-700 bg-navy-850 p-4">
          <h3 className="font-semibold text-ink">İşlem büyüklüğü hesabı</h3>
          <p className="mt-1 text-xs text-slate-400">Sermaye, hisseyle aynı para biriminde olmalı ({candidate.currency || 'hissenin para birimi'}). Bu hesap emir oluşturmaz.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-400">İşleme ayrılabilir sermaye<input aria-label="İşleme ayrılabilir sermaye" type="number" inputMode="decimal" min="0" disabled={!hasSizingData} value={capital} onChange={(event) => setCapital(event.target.value)} placeholder="Örn. 10000" className="mt-1 block w-full rounded-lg border border-navy-700 bg-navy-900 p-2 text-sm text-ink disabled:opacity-50" /></label><label className="text-xs text-slate-400">Sermayeden azami kayıp bütçesi (%)<input aria-label="Azami kayıp bütçesi yüzde" type="number" inputMode="decimal" min="0.01" max="5" step="0.1" disabled={!hasSizingData} value={riskBudget} onChange={(event) => setRiskBudget(event.target.value)} className="mt-1 block w-full rounded-lg border border-navy-700 bg-navy-900 p-2 text-sm text-ink disabled:opacity-50" /></label></div>
          <p className="mt-3 text-sm text-ink">{!hasSizingData?'İşlem büyüklüğü hesabı için giriş, zarar kes ve alış/satış verisi bekleniyor.':quantity === null ? 'Geçerli sermaye ve %0–5 arası kayıp bütçesi girerek hesapla.' : `${number(quantity, 0)} adet · Yaklaşık zarar kes + maliyet kaybı: ${price(quantity * lossPerShare, candidate.currency)}`}</p>
          <p className="mt-2 text-xs text-slate-500">Adet, zarar kes mesafesi ve maliyet varsayımıyla sınırlanır. Fiyat boşluğu veya kayma gerçekleşen kaybı bütçenin üzerine çıkarabilir.</p>
        </section>
        <section><h3 className="mb-2 font-semibold text-ink">Neden bu hisse?</h3><ul className="list-disc space-y-2 pl-5 text-sm text-slate-300">{reasons(candidate, 'reasons').map((reason, index) => <li key={index}>{reason}</li>)}</ul></section>
        <TradeContext context={candidate.context} />
        {(reasons(candidate, 'blockers').length > 0 || reasons(candidate, 'warnings').length > 0) && <section className="rounded-xl border border-amber-400/30 p-4"><h3 className="mb-2 flex items-center gap-2 font-semibold text-amber-400"><ShieldAlert size={16} /> Dikkat edilmesi gerekenler</h3><ul className="list-disc space-y-2 pl-5 text-sm text-slate-300">{[...reasons(candidate, 'blockers'), ...reasons(candidate, 'warnings')].map((reason, index) => <li key={index}>{reason}</li>)}</ul></section>}
        <section className="text-xs leading-relaxed text-slate-400"><p>Kaynak: {candidate.dataQuality?.source || 'Belirtilmemiş'} · Fiyat zamanı: {date(candidate.dataQuality?.quoteTime ?? candidate.dataQuality?.marketTime)}</p><p>Oluşturulma: {date(candidate.createdAt)}. Süreler açık seanstaki işlem saatleridir. Kalan seansa sığmayan senaryolar işlem için uygun sayılmaz.</p></section>
      </div>
    </section>
  </div>;
}

export default function TradePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [selectedSymbol, setSelectedSymbol] = useState(() => {
    const symbol = new URLSearchParams(window.location.search).get('symbol')?.toUpperCase();
    return symbol && /^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) ? symbol : null;
  });
  const clockAnchor = useRef(null);
  const preferenceRevision = useRef(0);
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState('');
  const closeDetail = useRef(() => setSelectedSymbol(null)).current;
  useEffect(() => {
    let active = true, timer, request, loading = false;
    async function load() {
      if (!active || loading || document.visibilityState === 'hidden') return;
      clearTimeout(timer);
      loading = true;
      request = new AbortController();
      const requestStarted = performance.now();
      const requestedPreferenceRevision = preferenceRevision.current;
      try {
        const next = await tradeRequest('state', { signal: request.signal });
        if (active && !request.signal.aborted) {
          const serverTime = Date.parse(next.serverTime);
          const monotonic = performance.now();
          // Conservatively include the whole request duration. A slow device
          // wall clock must never extend an actionable signal's lifetime.
          clockAnchor.current = Number.isFinite(serverTime)
            ? { server: serverTime + Math.max(0, monotonic - requestStarted), monotonic } : null;
          setNow(clockAnchor.current?.server ?? Number.POSITIVE_INFINITY);
          setData((previous) => requestedPreferenceRevision === preferenceRevision.current
            ? next : { ...next, preferences: previous?.preferences ?? next.preferences });
          setError('');
        }
      } catch (e) { if (active && !request.signal.aborted) {
        clockAnchor.current=null;setNow(Number.POSITIVE_INFINITY);
        setError(e.message || 'Trade bağlantısı kurulamadı.');
      } }
      finally {
        loading = false;
        if (active && document.visibilityState !== 'hidden') timer = setTimeout(load, 5000);
      }
    }
    function visibility() {
      clearTimeout(timer);
      clockAnchor.current = null;
      setNow(Number.POSITIVE_INFINITY);
      if (document.visibilityState === 'hidden') request?.abort();
      else load();
    }
    load();
    const clock = setInterval(() => setNow(clockAnchor.current
      ? clockAnchor.current.server + Math.max(0, performance.now() - clockAnchor.current.monotonic) : Number.POSITIVE_INFINITY), 1000);
    document.addEventListener('visibilitychange', visibility);
    return () => { active = false; clearTimeout(timer); clearInterval(clock); request?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  const items = data?.items ?? [];
  const selected = items.find((item) => item.symbol === selectedSymbol);
  const readyCount = items.filter((item) => live(item, now, data?.status)).length;
  const status = data?.status;
  const running = !error && status?.running && now - Date.parse(status.lastHeartbeatAt) <= (status.heartbeatMaxAgeMs ?? 30000)
    && Date.parse(status.lastHeartbeatAt) <= now + 2000;
  async function savePreference(enabled) {
    setPreferenceBusy(true); setPreferenceMessage('');
    try {
      const saved = await tradeRequest('preferences', { method: 'POST', body: { enabled } });
      preferenceRevision.current += 1;
      setData((previous) => ({ ...previous, preferences: { ...previous?.preferences, ...(saved.preferences ?? saved), enabled: saved.preferences?.enabled ?? saved.enabled ?? enabled } }));
      setPreferenceMessage(enabled ? 'Trade uyarıları hesabın için açıldı. Bu telefonda da aşağıdaki bildirim aboneliğini kaydet.' : 'Trade uyarıları hesabın için kapatıldı.');
    } catch (e) { setPreferenceMessage(e.message); }
    finally { setPreferenceBusy(false); }
  }
  return <div className="space-y-5">
    <section className={`${panel} space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent"><Activity size={15} /> Gün içi radar</p><h2 className="text-2xl font-semibold tracking-tight text-ink">Trade Önerileri</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">Gün içi fiyat, hacim ve haber koşullarını birlikte değerlendir. Her kartta işlem gerekçesi, tahmini süre ve zarar kes içeren hedef senaryolarını incele.</p></div><div className="rounded-xl border border-navy-700 bg-navy-850 px-4 py-3"><p className="text-2xl font-semibold tabular-nums text-ink">{readyCount}<span className="ml-2 text-sm font-normal text-slate-400">uygun sinyal</span></p><p className="mt-1 text-xs text-slate-500">{items.length} hisse izleniyor</p></div></div>
      <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500"><Info size={15} className="mt-0.5 shrink-0" /> Süreler oynaklığa dayalı yaklaşık işlem penceresidir; doğrulanmış süre tahmini değildir. Eski veya doğrulanmamış veriyle canlı işlem sinyali üretilmez. Bu ekran otomatik alım satım yapmaz.</p>
    </section>
    {error && <p role="alert" className="rounded-xl border border-loss/30 bg-loss/5 p-4 text-sm text-loss">{error}{data ? ' Son alınan veriler gösteriliyor; geçerlilik sürelerini kontrol edin.' : ''}</p>}
    {!data && !error && <p role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={18} className="animate-spin" /> Trade verileri yükleniyor…</p>}
    {status && <section aria-label="Trade veri bağlantısı" className={`${panel} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><span className={`h-2 w-2 rounded-full ${running && status.mode === 'licensed-http' ? 'bg-gain' : 'bg-amber-400'}`} />{running ? 'Trade çalışanı bağlı' : 'Canlı bağlantı bekleniyor'}</h3><span className="text-xs text-slate-500">Ekran açıkken 5 saniyede bir kontrol</span></div>
      {status.message && <p className="text-sm text-slate-400">{status.message}</p>}
      <div className="grid gap-x-6 gap-y-2 text-xs text-slate-400 sm:grid-cols-2 lg:grid-cols-4"><p>Kaynak: <span className="text-ink">{status.source || 'Tanımlanmamış'}</span></p><p>Son analiz: <span className="text-ink">{date(status.lastCycleAt)}</span></p><p>Son çalışan sinyali: <span className="text-ink">{date(status.lastHeartbeatAt)}</span></p><p>Ölçülen analiz gecikmesi: <span className="text-ink">{number(status.latencyMs, 0)} ms</span></p></div>
      <p className="text-xs text-slate-500">Kaynak fiyat yaşı sınırı: {number((status.quoteMaxAgeMs ?? 15000) / 1000, 0)} sn. Telefonun ağ ve işletim sistemi nedeniyle bildirim teslim süresi garanti edilemez.</p>
    </section>}
    <section aria-label="Trade hisse kartları" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((candidate) => {
        const actionable = live(candidate, now, status);
        const expired = candidate.status === 'ready' && !actionable;
        const researchOnly = candidate.availability === 'research-only';
        return <button key={candidate.symbol} onClick={() => setSelectedSymbol(candidate.symbol)} aria-label={`${candidate.symbol} trade detayını aç`} className="group flex h-full flex-col rounded-xl border border-navy-700 bg-navy-900 p-5 text-left transition-colors hover:border-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <div className="mb-4 flex w-full items-start justify-between gap-3"><div><h3 className="text-lg font-semibold text-ink">{candidate.symbol}</h3><p className="mt-1 text-xs text-slate-400">{candidate.name || candidate.market}</p></div><ArrowUpRight size={20} className="shrink-0 text-slate-500 group-hover:text-accent" /></div>
          <span className={`mb-4 inline-flex self-start rounded-full px-2.5 py-1 text-xs font-medium ${actionable ? 'bg-gain/10 text-gain' : 'bg-amber-400/10 text-amber-400'}`}>{researchOnly ? 'Canlı veri bağlantısı bekleniyor' : expired ? 'Süresi doldu' : STATUS_LABELS[candidate.status] || 'İzlemede'}</span>
          <p className="text-xl font-semibold tabular-nums text-ink">{researchOnly && candidate.entry == null ? 'Gün içi fiyat bekleniyor' : price(candidate.entry, candidate.currency)}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-accent"><Clock3 size={14} />{duration(candidate.estimatedHours)}</p>
          {researchOnly && <p className="mt-3 text-xs leading-relaxed text-slate-400">Mevcut fırsat analizinden araştırma adayı. Gün içi işlem planı için bu hisseye ait doğrulanmış canlı fiyat ve hacim akışı gerekli.</p>}
          <div className="mt-4 w-full border-t border-navy-700 pt-4"><p className="mb-2 text-xs font-semibold text-slate-400">Neden bu hisse?</p><ul className="space-y-2 text-sm leading-relaxed text-slate-300">{reasons(candidate, 'reasons').slice(0, 3).map((reason, index) => <li key={index}>{reason}</li>)}</ul>{!reasons(candidate, 'reasons').length && <p className="text-sm text-slate-400">İşlem gerekçesi için veri toplanıyor.</p>}</div>
          {reasons(candidate, 'blockers')[0] && <p className="mt-4 text-xs leading-relaxed text-amber-400">{reasons(candidate, 'blockers')[0]}</p>}
          <p className="mt-auto pt-4 text-[11px] text-slate-500">Oluşturulma: {date(candidate.createdAt)}</p>
        </button>;
      })}
    </section>
    {data && !items.length && <section className="rounded-xl border border-dashed border-navy-700 p-8 text-center"><Activity size={26} className="mx-auto mb-3 text-slate-500" /><h3 className="font-semibold text-ink">Şu an gösterilecek trade adayı yok</h3><p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-400">İzlenen hisseler için veri akışı ve risk koşulları sağlandığında kartlar burada görünür. Seans dışında veya veri bağlantısı eksikken uygun sinyal beklenir.</p></section>}
    <section className={`${panel} space-y-4`} aria-label="Trade uyarı tercihleri"><h3 className="flex items-center gap-2 font-semibold text-ink"><Bell size={17} /> Trade uyarıları</h3><label className="flex items-start gap-3 text-sm text-slate-300"><input type="checkbox" className="mt-1" checked={Boolean(data?.preferences?.enabled)} disabled={!data || preferenceBusy} onChange={(event) => savePreference(event.target.checked)} /><span>Hesabım için trade uyarılarını aç<span className="mt-1 block text-xs leading-relaxed text-slate-400">Yalnızca güncel veriyle koşulları karşılayan sinyaller bildirilir. Telefona teslim için bu cihazda “Trade sinyalleri” konusunu da kaydet.</span></span></label>{preferenceMessage && <p role="status" className="text-xs text-amber-400">{preferenceMessage}</p>}<NotificationSettings suggestedTopics={PHONE_TOPICS} /></section>
    {(data?.requirements ?? []).length > 0 && <details className={panel}><summary className="cursor-pointer font-semibold text-ink">Trade için gerekenler ve veri durumu</summary><ul className="mt-4 space-y-4">{data.requirements.map((requirement) => <li key={requirement.id || requirement.label} className="border-t border-navy-700 pt-3"><div className="flex items-center justify-between gap-3"><h4 className="text-sm font-medium text-ink">{requirement.label}</h4><span className={`shrink-0 text-xs ${requirement.status === 'available' ? 'text-gain' : 'text-amber-400'}`}>{REQUIREMENT_LABELS[requirement.status] || requirement.status}</span></div>{requirement.detail && <p className="mt-1 text-xs leading-relaxed text-slate-400">{requirement.detail}</p>}</li>)}</ul></details>}
    {selected && <TradeDetail candidate={selected} now={now} status={status} onClose={closeDetail} />}
  </div>;
}

import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Clock3, History, Info, Loader2, RefreshCw, Search } from 'lucide-react';
import { tradeRequest } from '../services/trade.js';

const STATUS = {
  pending: 'Giriş bekliyor', active: 'Takipte', target: 'Hedefe ulaştı', stop: 'Stop oldu',
  expired: 'Süre doldu', ambiguous: 'Sıra belirsiz', unresolved: 'Değerlendirilemedi',
};
const STRATEGIES = [
  ['intraday', 'Gün içi trade'], ['choch-fib-pullback', 'CHoCH + Fibonacci'],
  ['parallel-channel-reversal', 'Paralel kanal'],
];
const panel = 'rounded-xl border border-navy-700 bg-navy-900 p-4 sm:p-5';
const input = 'mt-1 block w-full rounded-lg border border-navy-700 bg-navy-850 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none';
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const number = (value, digits = 2) => finite(value) ? value.toLocaleString('tr-TR', { maximumFractionDigits: digits }) : '—';
const price = (value, currency) => finite(value) ? `${number(value, 4)} ${currency || ''}`.trim() : '—';
const percent = (value, signed = false) => finite(value) ? `${value < 0 ? '-' : signed && value > 0 ? '+' : ''}%${number(Math.abs(value))}` : '—';
function date(value) {
  const parsed = new Date(value);
  return value && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '—';
}
function statusColor(status) {
  return status === 'target' ? 'bg-gain/10 text-gain' : status === 'stop' ? 'bg-loss/10 text-loss'
    : ['active', 'pending'].includes(status) ? 'bg-accent/10 text-accent' : 'bg-amber-400/10 text-amber-400';
}
function Status({ value, label }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${statusColor(value)}`}>{label || STATUS[value] || 'Durum bekleniyor'}</span>;
}

function HistoryDetail({ item }) {
  return <div className="space-y-4 rounded-lg bg-navy-850 p-4">
    <dl className="grid gap-3 text-xs sm:grid-cols-3">
      <div><dt className="text-slate-400">Sabitlenen giriş bölgesi</dt><dd className="mt-1 text-ink">{price(item.entryLow ?? item.entry, item.currency)} – {price(item.entryHigh ?? item.entry, item.currency)}</dd></div>
      <div><dt className="text-slate-400">İlk zarar kes</dt><dd className="mt-1 text-loss">{price(item.stopLoss, item.currency)}</dd></div>
      <div><dt className="text-slate-400">Takip sonu</dt><dd className="mt-1 text-ink">{date(item.trackingEndsAt)}</dd></div>
      <div><dt className="text-slate-400">Giriş bekleme sonu</dt><dd className="mt-1 text-ink">{date(item.entryDeadlineAt)}</dd></div>
      <div><dt className="text-slate-400">Model giriş zamanı</dt><dd className="mt-1 text-ink">{date(item.enteredAt)}</dd></div>
      <div><dt className="text-slate-400">Kapanış zamanı</dt><dd className="mt-1 text-ink">{date(item.closedAt)}</dd></div>
      <div><dt className="text-slate-400">Son değerlendirme</dt><dd className="mt-1 text-ink">{date(item.lastCheckedAt)}</dd></div>
    </dl>
    {item.executionModel && <p className="text-xs leading-relaxed text-slate-400">{item.executionModel}</p>}
    <div className="grid gap-2 sm:grid-cols-3">{(item.targets ?? []).map((target, index) => <div key={target.id ?? index} className="rounded-lg border border-navy-700 p-3">
      <p className="text-xs font-medium text-slate-300">{target.label || `Hedef ${index + 1}`}</p>
      <p className="my-2 text-sm font-semibold tabular-nums text-ink">{price(target.targetPrice, item.currency)}</p>
      <Status value={target.status} label={target.status === 'pending' && item.enteredAt ? 'Hedef bekleniyor' : undefined} />
      {finite(target.netReturnPct) && <p className={`mt-2 text-xs tabular-nums ${target.netReturnPct >= 0 ? 'text-gain' : 'text-loss'}`}>Model net: {percent(target.netReturnPct, true)}</p>}
      {target.hitAt && <p className="mt-1 text-[11px] text-slate-500">{date(target.hitAt)}</p>}
    </div>)}</div>
    <div><h4 className="mb-2 text-xs font-semibold text-slate-300">Zaman çizelgesi</h4>
      {(item.events ?? []).length ? <ol className="space-y-2 border-l border-navy-700 pl-3">{item.events.map((event, index) => <li key={`${event.at}-${index}`} className="text-xs leading-relaxed">
        <span className="text-slate-500">{date(event.at)}</span><p className="text-slate-300">{event.message || 'Plan güncellendi.'}{finite(event.price) ? ` · ${price(event.price, item.currency)}` : ''}</p>
      </li>)}</ol> : <p className="text-xs text-slate-500">Henüz yeni fiyat olayı kaydedilmedi.</p>}
    </div>
    <p className="text-[11px] leading-relaxed text-slate-500">İlk planın seviyeleri korunur. Gidiş dönüş maliyet varsayımı {number(item.costBps)} baz puandır.{item.costAssumed ? ' Spread dahil tüm gerçekleşme maliyetleri doğrulanmamıştır.' : ''} Sonuçlar model gözlemidir; aracı kurum hesabındaki gerçekleşen kazanç veya kayıp değildir.</p>
  </div>;
}

export default function TradeHistoryPanel() {
  const [filters, setFilters] = useState({ period: '30', mode: 'research', status: 'all', symbol: '', strategy: 'all' });
  const [symbolDraft, setSymbolDraft] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const queryKey = JSON.stringify({ ...filters, page });

  useEffect(() => {
    let active = true, loading = false, timer, request;
    const query = JSON.parse(queryKey);
    async function load() {
      if (!active || loading || document.visibilityState === 'hidden') return;
      clearTimeout(timer);
      loading = true; setBusy(true);
      request = new AbortController();
      try {
        const result = await tradeRequest('history', { query, signal: request.signal });
        if (active && !request.signal.aborted) { setData(result); setError(''); }
      } catch (e) {
        if (active && !request.signal.aborted) setError(e.message || 'Trade geçmişi alınamadı.');
      } finally {
        loading = false;
        if (active) {
          setBusy(false);
          if (document.visibilityState !== 'hidden') timer = setTimeout(load, 30000);
        }
      }
    }
    function visibility() {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') request?.abort();
      else load();
    }
    load();
    document.addEventListener('visibilitychange', visibility);
    return () => { active = false; clearTimeout(timer); request?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [queryKey, reload]);

  function updateFilter(key, value) {
    if (filters[key] === value) return;
    setData(null); setError(''); setBusy(true); setExpanded(null); setPage(1);
    setFilters((previous) => ({ ...previous, [key]: value }));
  }
  function changePage(next) {
    setData(null); setError(''); setBusy(true); setExpanded(null); setPage(next);
  }
  const items = data?.items ?? [];
  const summary = data?.summary;
  const pagination = data?.pagination;
  const tracking = data?.tracking;
  const installationRequired = Boolean(data?.installationRequired);
  const stats = [
    ['Arşivlenen plan', number(summary?.total, 0), `${number(summary?.pending ?? 0, 0)} giriş bekliyor · ${number(summary?.active ?? 0, 0)} takipte`],
    ['Sonucu belli', number(summary?.resolved, 0), 'İlk hedefi veya stopu doğrulanan planlar'],
    ['Hedefe ulaşma', percent(summary?.winRate ?? summary?.targetRate), `Stop oranı ${percent(summary?.stopRate)}`],
    ['Ortalama model net', percent(summary?.averageNetReturnPct, true), `Maliyet sonrası kapanan modeller${finite(summary?.settledCount) ? ` · ${number(summary.settledCount, 0)} sonuç` : ''}`],
  ];

  return <div className="space-y-4">
    <section className={`${panel} space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="flex items-center gap-2 text-lg font-semibold text-ink"><History size={20} className="text-accent" /> Geçmiş Tradeler</h3><p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">Kaydedilen planların giriş, hedef ve stop sonuçlarını izle. Araştırma senaryolarını ve canlı kaynakla üretilen planları ayrı filtreleyebilirsin.</p></div>
        <button type="button" onClick={() => setReload((value) => value + 1)} disabled={busy} className="flex items-center gap-2 rounded-lg border border-navy-700 px-3 py-2 text-xs text-slate-300 hover:border-accent/50 disabled:opacity-50"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />Geçmişi yenile</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className="text-xs text-slate-400">Dönem<select aria-label="Geçmiş dönemi" className={input} value={filters.period} onChange={(event) => updateFilter('period', event.target.value)}><option value="7">Son 7 gün</option><option value="30">Son 30 gün</option><option value="90">Son 90 gün</option><option value="all">Tüm zamanlar</option></select></label>
        <label className="text-xs text-slate-400">Veri türü<select aria-label="Geçmiş veri türü" className={input} value={filters.mode} onChange={(event) => updateFilter('mode', event.target.value)}><option value="all">Tüm kayıtlar</option><option value="research">Gecikmeli araştırma</option><option value="live">Canlı kaynak</option></select></label>
        <label className="text-xs text-slate-400">Sonuç<select aria-label="Geçmiş sonucu" className={input} value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}><option value="all">Tüm sonuçlar</option>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-xs text-slate-400">Strateji<select aria-label="Geçmiş stratejisi" className={input} value={filters.strategy} onChange={(event) => updateFilter('strategy', event.target.value)}><option value="all">Tüm stratejiler</option>{STRATEGIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <form onSubmit={(event) => { event.preventDefault(); updateFilter('symbol', symbolDraft.trim().toUpperCase()); }} className="text-xs text-slate-400"><label htmlFor="history-symbol">Hisse</label><div className="mt-1 flex gap-1"><input id="history-symbol" aria-label="Geçmiş hisse sembolü" value={symbolDraft} onChange={(event) => setSymbolDraft(event.target.value)} maxLength={15} placeholder="Örn. AAPL" pattern="[A-Za-z][A-Za-z0-9.\-]{0,14}|" className={`${input} mt-0 min-w-0 uppercase`} /><button type="submit" aria-label="Hisse geçmişini filtrele" className="rounded-lg border border-navy-700 px-2.5 text-slate-300 hover:border-accent/50"><Search size={16} /></button></div></form>
      </div>
    </section>

    {error && <p role="alert" className="rounded-xl border border-loss/30 bg-loss/5 p-4 text-sm text-loss">{error}{data ? ' Son alınan kayıtlar gösteriliyor; yeni sonuçlar henüz doğrulanmadı.' : ''}</p>}
    {!data && busy && <p role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={18} className="animate-spin" />Trade geçmişi yükleniyor…</p>}
    {installationRequired ? <section className={`${panel} border-amber-400/30`}><h4 className="font-semibold text-amber-400">Geçmiş takibi kurulum bekliyor</h4><p className="mt-2 text-sm leading-relaxed text-slate-400">Geçmiş kaydı henüz etkinleştirilmemiş. Kurulum tamamlandığında yeni planlar burada birikir.</p></section> : data && <>
      <section aria-label="Trade performans özeti" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{stats.map(([label, value, description]) => <div key={label} className={panel}><p className="text-xs font-medium text-slate-400">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{value}</p><p className="mt-2 text-[11px] leading-relaxed text-slate-500">{description}</p></div>)}</section>
      <div className="flex items-start gap-2 px-1 text-xs leading-relaxed text-slate-400"><Info size={15} className="mt-0.5 shrink-0 text-accent" /><p>Her plan, başarı hesabında ilk hedefiyle bir kez sayılır. Giriş oluşmayan, süresi dolan, sırası belirsiz ve veri eksiği olan sonuçlar başarı oranına katılmaz. Ortalama model net, girişten sonra süre sonunda doğrulanmış kapanışları da içerir. Sonuçlar varsayımsal işlem takibidir.{filters.mode === 'all' ? ' Bu özet, araştırma ve canlı kaynaklı model sonuçlarını birlikte içerir.' : ''}</p></div>
      {(summary?.byTarget ?? []).length > 1 && <section aria-label="Hedef bazında sonuçlar" className="grid gap-3 sm:grid-cols-3">{summary.byTarget.map((target, index) => <div key={`${target.strategyId}-${target.id ?? index}`} className="rounded-xl border border-navy-700 bg-navy-850 p-3"><p className="text-xs font-medium text-slate-300">{target.label || `Hedef ${index + 1}`}</p>{target.strategyId && <p className="mt-1 text-[11px] text-slate-500">{STRATEGIES.find(([id]) => id === target.strategyId)?.[1] || target.strategyId}</p>}<p className="mt-1 text-sm text-ink">{percent(target.winRate)} hedefe ulaşma <span className="text-xs text-slate-500">· {number(target.resolved, 0)} sonuç</span></p></div>)}</section>}
      <section aria-label="Kaydedilmiş trade planları" className="overflow-hidden rounded-xl border border-navy-700 bg-navy-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-navy-700 px-4 py-3"><h4 className="text-sm font-semibold text-ink">Plan günlüğü</h4><p className="text-xs text-slate-500">{number(pagination?.total ?? summary?.total, 0)} kayıt</p></div>
        {!items.length ? <div className="p-8 text-center"><History size={28} className="mx-auto mb-3 text-slate-500" /><h4 className="font-semibold text-ink">Bu filtrelerde kayıtlı trade yok</h4><p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-400">Takip, kurulumdan sonra oluşan yeni planlarla başlar. Önceki analizlerin üzerine yazılan seviyelerden geçmiş başarı üretilmez.</p></div> : <div className="divide-y divide-navy-700">{items.map((item) => <article key={item.id} className="p-4 sm:p-5">
          <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1.5fr)_1fr_1fr_auto]">
            <div><div className="flex flex-wrap items-center gap-2"><h5 className="font-semibold text-ink">{item.symbol}</h5><span className="rounded bg-navy-800 px-1.5 py-0.5 text-[10px] text-slate-400">{item.mode === 'live' ? 'Canlı kaynak' : 'Gecikmeli araştırma'}</span><span className={`inline-flex items-center text-xs ${item.direction === 'short' ? 'text-loss' : 'text-gain'}`}>{item.direction === 'short' ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{item.direction === 'short' ? 'Short' : 'Long'}</span></div><p className="mt-1 text-xs text-slate-300">{item.strategyName || 'Gün içi trade'}</p><p className="mt-1 text-[11px] text-slate-500">{date(item.createdAt)}</p></div>
            <dl className="grid grid-cols-2 gap-3 text-xs md:grid-cols-1 md:gap-1"><div><dt className="text-slate-500">Giriş referansı</dt><dd className="mt-0.5 tabular-nums text-ink">{price(item.entry, item.currency)}</dd></div><div><dt className="text-slate-500">İlk hedef</dt><dd className="mt-0.5 tabular-nums text-gain">{price(item.targets?.[0]?.targetPrice, item.currency)}</dd></div></dl>
            <div><Status value={item.status} /><p className={`mt-2 text-sm font-semibold tabular-nums ${finite(item.netReturnPct) ? item.netReturnPct >= 0 ? 'text-gain' : 'text-loss' : 'text-slate-500'}`}>{percent(item.netReturnPct, true)}<span className="ml-1 text-[11px] font-normal text-slate-500">model net</span></p></div>
            <button type="button" aria-expanded={expanded === item.id} aria-controls={`trade-history-${item.id}`} onClick={() => setExpanded((previous) => previous === item.id ? null : item.id)} className="justify-self-start rounded-lg border border-navy-700 px-3 py-2 text-xs text-slate-300 hover:border-accent/50">{expanded === item.id ? 'Detayı kapat' : 'Planı incele'}<span className="sr-only"> · {item.symbol}</span></button>
          </div>
          {expanded === item.id && <div id={`trade-history-${item.id}`} className="mt-4"><HistoryDetail item={item} /></div>}
        </article>)}</div>}
        {(pagination?.hasMore || page > 1) && <div className="flex items-center justify-between gap-3 border-t border-navy-700 p-3"><button type="button" disabled={page <= 1 || busy} onClick={() => changePage(page - 1)} className="rounded-lg border border-navy-700 px-3 py-2 text-xs text-slate-300 disabled:opacity-40">Önceki</button><span className="text-xs text-slate-400">Sayfa {number(pagination?.page ?? page, 0)}</span><button type="button" disabled={!pagination?.hasMore || busy} onClick={() => changePage(page + 1)} className="rounded-lg border border-navy-700 px-3 py-2 text-xs text-slate-300 disabled:opacity-40">Sonraki</button></div>}
      </section>
      <div className="flex items-start gap-2 px-1 text-[11px] leading-relaxed text-slate-500"><Clock3 size={14} className="mt-0.5 shrink-0" /><p>{tracking?.message || 'Kayıtlar sunucunun aldığı yeni mumlarla değerlendirilir. Bu ekran 30 saniyede bir kayıtları kontrol eder.'}{tracking?.lastCheckedAt ? ` Son değerlendirme: ${date(tracking.lastCheckedAt)}.` : ''}</p></div>
    </>}
  </div>;
}

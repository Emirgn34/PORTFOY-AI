import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  Database,
  ExternalLink,
  Landmark,
  Loader2,
  Search,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import useSyncedState from '../hooks/useSyncedState.js';
import { SEED_STOCKS } from '../data/seedPortfolio.js';
import { SEED_WATCHLIST } from '../data/seedWatchlist.js';
import { MOCK_ENABLED } from '../config.js';
import { MOCK_LONG_TERM_CANDIDATES } from '../data/mockLongTermCandidates.js';
import { MOCK_SHORT_TERM_CANDIDATES } from '../data/mockShortTermCandidates.js';
import { fetchLiveCandidates } from '../services/liveData.js';
import {
  fetchInstitutionalManagers,
  fetchInstitutionalMoves,
  fetchMacroCalendar,
  fetchMarketIntelligence,
  fetchSecFilings,
} from '../services/research.js';
import { scoreAndRankCandidates } from '../utils/opportunityScoring.js';
import { buildThemeInsights } from '../utils/researchInsights.js';
import { formatCurrency, formatPercent } from '../utils/portfolioCalculations.js';

const TABS = [
  { id: 'dashboard', label: 'Özel Takip Panosu', icon: Activity },
  { id: 'screener', label: 'Finansal Tarama', icon: SlidersHorizontal },
  { id: 'filings', label: 'SEC & 13F', icon: Landmark },
  { id: 'macro', label: 'Makro Takvim', icon: CalendarDays },
];

function PanelState({ icon: Icon = CircleDashed, title, body }) {
  return (
    <div className="rounded-xl border border-dashed border-navy-700 bg-navy-900/50 px-5 py-10 text-center">
      <Icon size={28} className="mx-auto text-slate-500" />
      <p className="mt-3 text-sm font-semibold text-slate-300">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">{body}</p>}
    </div>
  );
}

function LoadingPanel({ label = 'Veriler hazırlanıyor…' }) {
  return (
    <div className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-navy-700 bg-navy-900 text-sm text-slate-400">
      <Loader2 size={17} className="animate-spin text-accent" />
      {label}
    </div>
  );
}

function daysUntil(date) {
  if (!date) return null;
  const dayNumber = (value) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(parsed);
    const part = (type) => Number(parts.find((item) => item.type === type)?.value);
    return Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000;
  };
  const targetDay = dayNumber(date);
  const today = dayNumber(new Date());
  return targetDay == null || today == null ? null : targetDay - today;
}

function numberOrDash(value, digits = 1) {
  return value == null || Number.isNaN(Number(value)) ? '—' : Number(value).toFixed(digits);
}

function formatCompactUsd(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatEpsConsensus(earnings) {
  if (earnings?.epsEstimate == null) return '—';
  const average = `${numberOrDash(earnings.epsEstimate, 2)} ort.`;
  if (earnings.epsLow == null || earnings.epsHigh == null) return average;
  return `${average} (${numberOrDash(earnings.epsLow, 2)}–${numberOrDash(earnings.epsHigh, 2)})`;
}

export default function ResearchPage() {
  const [stocks, , portfolioState] = useSyncedState({
    table: 'portfolios',
    column: 'stocks',
    localKey: 'portfoyai_stocks',
    seed: SEED_STOCKS,
    readOnly: true,
  });
  const [watchlist, , watchState] = useSyncedState({
    table: 'watchlists',
    column: 'items',
    localKey: 'portfoyai_watchlist',
    seed: SEED_WATCHLIST,
    readOnly: true,
  });
  if (portfolioState.loading || watchState.loading) {
    return <LoadingPanel label="Portföy ve takip kapsamı yükleniyor…" />;
  }
  return <ResearchContent stocks={stocks} watchlist={watchlist} />;
}

function ResearchContent({ stocks, watchlist }) {
  const [tab, setTab] = useState('dashboard');
  const [intelligence, setIntelligence] = useState(null);
  const [intelligenceLoading, setIntelligenceLoading] = useState(true);
  const [macro, setMacro] = useState(null);
  const [candidates, setCandidates] = useState({
    short: [],
    long: [],
    generatedAt: null,
    source: 'loading',
    longSource: 'loading',
  });
  const [candidateLoading, setCandidateLoading] = useState(true);

  const researchScope = useMemo(() => {
    const map = new Map();
    for (const item of [...stocks, ...watchlist]) {
      const key = `${item.market}:${item.ticker}`;
      if (!map.has(key)) map.set(key, item);
    }
    return [...map.values()];
  }, [stocks, watchlist]);
  const scopeKey = researchScope.map((item) => `${item.market}:${item.ticker}`).join(',');

  useEffect(() => {
    let active = true;
    setIntelligenceLoading(true);
    fetchMarketIntelligence(researchScope).then((result) => {
      if (!active) return;
      setIntelligence(result);
      setIntelligenceLoading(false);
    });
    return () => {
      active = false;
    };
    // Yalnızca sembol kapsamı değiştiğinde yeniden çek.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  useEffect(() => {
    let active = true;
    fetchMacroCalendar({ days: 90 }).then((result) => active && setMacro(result));
    Promise.all([fetchLiveCandidates('short'), fetchLiveCandidates('long')]).then(([short, long]) => {
      if (!active) return;
      const shortIsLive = Array.isArray(short?.candidates);
      const longIsLive = Array.isArray(long?.candidates);
      const usesMock = MOCK_ENABLED && (!shortIsLive || !longIsLive);
      setCandidates({
        short: short?.candidates ?? (MOCK_ENABLED ? MOCK_SHORT_TERM_CANDIDATES : []),
        long: long?.candidates ?? (MOCK_ENABLED ? MOCK_LONG_TERM_CANDIDATES : []),
        generatedAt: long?.generatedAt ?? short?.generatedAt ?? new Date().toISOString(),
        source: usesMock
          ? 'mock'
          : shortIsLive && longIsLive
            ? 'live'
            : shortIsLive || longIsLive
              ? 'partial'
              : 'unavailable',
        longSource: longIsLive ? 'live' : MOCK_ENABLED ? 'mock' : 'unavailable',
      });
      setCandidateLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-ink">Araştırma Merkezi</h2>
        <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
          Portföy ve takip listenizi; bilanço hazırlığı, temel rasyolar, resmî SEC bildirimleri,
          kurumsal 13F hareketleri ve yüksek etkili makro olaylarla tek yerde izleyin.
        </p>
      </div>

      <div className="flex overflow-x-auto rounded-lg border border-navy-700 bg-navy-900 p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`flex min-w-max flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
              tab === id ? 'bg-accent text-white' : 'text-slate-400 hover:bg-navy-800 hover:text-ink'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && (
        <DashboardPanel
          scope={researchScope}
          data={intelligence}
          loading={intelligenceLoading}
          candidates={[...candidates.short, ...candidates.long]}
        />
      )}
      {tab === 'screener' && (
        <ScreenerPanel candidates={candidates} loading={candidateLoading} />
      )}
      {tab === 'filings' && <FilingsPanel defaultScope={researchScope} />}
      {tab === 'macro' && <MacroPanel data={macro} />}
    </div>
  );
}

function DashboardPanel({ scope, data, loading, candidates }) {
  if (loading) return <LoadingPanel label="Bilanço, hedef fiyat ve IV verileri alınıyor…" />;
  if (data?.error) {
    return <PanelState icon={ShieldAlert} title="Canlı araştırma servisine ulaşılamadı" body={data.error} />;
  }
  if (!scope.length) {
    return <PanelState title="Takip edilecek hisse yok" body="Portföyünüze veya takip listenize hisse ekleyince özel pano otomatik oluşur." />;
  }
  const resultItems = data?.items ?? [];
  const failedItems = resultItems.filter((item) => item.error);
  const items = resultItems.filter((item) => !item.error);
  const catalystBySymbol = new Map();
  for (const candidate of candidates ?? []) {
    const symbol = String(candidate.symbol ?? '').replace(/\.IS$/, '').toUpperCase();
    if (!symbol) continue;
    const existing = catalystBySymbol.get(symbol);
    const date = new Date(candidate.catalystDate ?? 0).getTime();
    const existingDate = new Date(existing?.catalystDate ?? 0).getTime();
    if (!existing || date > existingDate) catalystBySymbol.set(symbol, candidate);
  }
  if (!items.length && failedItems.length) {
    return (
      <PanelState
        icon={ShieldAlert}
        title="Takip kapsamındaki hisseler alınamadı"
        body={`${failedItems.map((item) => item.symbol).join(', ')} için piyasa verisi döndürülemedi.`}
      />
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="Başarılı veri kapsamı" value={`${items.length}/${scope.length}`} />
        <Metric
          label="14 gün içinde bilanço"
          value={items.filter((item) => {
            const days = daysUntil(item.earnings?.date);
            return days != null && days >= 0 && days <= 14;
          }).length}
          tone="amber"
        />
        <Metric label="IV verisi bulunan" value={items.filter((item) => item.options).length} />
      </div>

      {(failedItems.length > 0 || data?.batchErrors?.length > 0 || data?.partial) && (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-400" role="status">
          Kısmi veri: {failedItems.length > 0
            ? `${failedItems.map((item) => item.symbol).join(', ')} için sembol verisi alınamadı.`
            : data?.batchErrors?.length > 0
              ? `${data.batchErrors.length} veri partisine ulaşılamadı.`
              : `${scope.length} sembolün ${items.length} tanesi için veri döndü.`}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-navy-700 bg-navy-900">
        <table className="w-full min-w-[1380px] text-xs">
          <thead className="border-b border-navy-700 text-left uppercase tracking-wide text-slate-500">
            <tr>
              {['Hisse', 'F/K', 'PEG', 'Borç/Öz.', 'Satış Büy.', 'Bilanço', 'EPS Konsensüs', 'Analist Hedefi', 'IV', 'İma Edilen Hareket', 'Güncel Katalizör'].map((label) => (
                <th key={label} className="px-3 py-3 font-medium">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const earningsDays = daysUntil(item.earnings?.date);
              const catalyst = catalystBySymbol.get(String(item.ticker ?? '').toUpperCase());
              return (
                <tr key={item.symbol} className="border-b border-navy-800 last:border-0">
                  <td className="px-3 py-3">
                    <span className="font-bold text-ink">{item.ticker}</span>
                    <span className="ml-2 text-slate-500">{item.companyName}</span>
                  </td>
                  <td className="px-3 py-3 tabular-nums">{numberOrDash(item.fundamentals?.trailingPE)}</td>
                  <td className="px-3 py-3 tabular-nums">{numberOrDash(item.fundamentals?.pegRatio, 2)}</td>
                  <td className="px-3 py-3 tabular-nums">{numberOrDash(item.fundamentals?.debtToEquity)}</td>
                  <td className={`px-3 py-3 tabular-nums ${item.fundamentals?.revenueGrowthPct >= 0 ? 'text-gain' : 'text-loss'}`}>
                    {item.fundamentals?.revenueGrowthPct == null ? '—' : formatPercent(item.fundamentals.revenueGrowthPct)}
                  </td>
                  <td className="px-3 py-3">
                    {item.earnings?.date ? (
                      <span className={earningsDays != null && earningsDays >= 0 && earningsDays <= 14 ? 'font-semibold text-amber-400' : 'text-slate-300'}>
                        {new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(item.earnings.date))}
                        {earningsDays != null && earningsDays >= 0 && <small className="ml-1 text-slate-500">({earningsDays} gün)</small>}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {formatEpsConsensus(item.earnings)}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {item.analyst?.targetMean == null ? '—' : formatCurrency(item.analyst.targetMean, item.currency)}
                  </td>
                  <td className="px-3 py-3 tabular-nums">{item.options ? `%${item.options.impliedVolatilityPct}` : '—'}</td>
                  <td className="px-3 py-3 font-semibold tabular-nums text-amber-400">
                    {item.options ? `±%${item.options.expectedMovePct}` : '—'}
                  </td>
                  <td className="max-w-64 px-3 py-3 text-slate-400">
                    {catalyst ? (
                      <span title={catalyst.strongestCatalystSummary ?? catalyst.reasonShort ?? ''}>
                        {catalyst.strongestCatalystTitle ?? catalyst.reasonShort ?? 'Somut olay takibi'}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        Konsensüs ve opsiyon verileri hızlı MVP katmanında gayriresmî Yahoo verisidir; işlem öncesi aracı kurum/OPRA kaynağıyla doğrulanmalıdır.
        İma edilen hareket, bilanço tarihi biliniyorsa o tarihi kapsayan ilk (aksi halde en yakın)
        vadedeki ATM call/put IV ortalamasından yaklaşık hesaplanır.
      </p>
    </div>
  );
}

function Metric({ label, value, tone = 'default' }) {
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-900 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${tone === 'amber' ? 'text-amber-400' : 'text-ink'}`}>{value}</p>
    </div>
  );
}

function ScreenerPanel({ candidates, loading }) {
  const [filters, setFilters] = useState({ market: 'all', maxPe: '', maxPeg: '', maxDebt: '', minGrowth: '', minScore: '50' });
  const ranked = useMemo(
    () => scoreAndRankCandidates(candidates.long, 'long', candidates.generatedAt),
    [candidates]
  );
  const matching = useMemo(
    () =>
      ranked.filter((candidate) => {
        const f = candidate.fundamentals ?? {};
        if (
          filters.market !== 'all' &&
          (filters.market === 'US'
            ? candidate.market === 'BIST'
            : candidate.market !== filters.market)
        ) {
          return false;
        }
        if (filters.maxPe !== '' && (f.peRatio == null || f.peRatio > Number(filters.maxPe))) return false;
        if (filters.maxPeg !== '' && (f.pegRatio == null || f.pegRatio > Number(filters.maxPeg))) return false;
        if (filters.maxDebt !== '' && (f.debtToEquity == null || f.debtToEquity > Number(filters.maxDebt))) return false;
        if (filters.minGrowth !== '' && (f.revenueGrowthPct == null || f.revenueGrowthPct < Number(filters.minGrowth))) return false;
        if (candidate.shortTermScore < Number(filters.minScore || 0)) return false;
        return true;
      }),
    [ranked, filters]
  );
  const filtered = matching.slice(0, 100);
  const themes = useMemo(() => buildThemeInsights(ranked), [ranked]);
  if (loading) return <LoadingPanel label="Temel tarama havuzu hazırlanıyor…" />;
  if (candidates.longSource === 'unavailable') {
    return <PanelState icon={ShieldAlert} title="Canlı tarama verisi alınamadı" body="Bu durum filtreleri geçen şirket olmadığı anlamına gelmez. Veri bağlantısını kontrol edip yeniden deneyin." />;
  }
  if (!ranked.length) return <PanelState title="Tarama verisi henüz yok" body="Aday üreticisi tamamlandığında F/K, PEG, borç/özsermaye ve satış büyümesi filtreleri burada çalışır." />;
  const field = (key, label, placeholder) => (
    <label className="block text-[11px] font-medium text-slate-500">
      {label}
      <input
        type="number"
        value={filters[key]}
        placeholder={placeholder}
        onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))}
        className="mt-1 w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-ink placeholder:text-slate-600"
      />
    </label>
  );
  return (
    <div className="space-y-4">
      {candidates.longSource === 'mock' && (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-400" role="status">
          Bu tarama tarihsel örnek veriyle çalışıyor; güncel yatırım kararı için kullanılmamalıdır.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-navy-700 bg-navy-900 p-4 md:grid-cols-6">
        <label className="block text-[11px] font-medium text-slate-500">
          Pazar
          <select value={filters.market} onChange={(event) => setFilters((current) => ({ ...current, market: event.target.value }))} className="mt-1 w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-ink">
            <option value="all">Tümü</option><option value="BIST">BIST</option><option value="NASDAQ">NASDAQ</option><option value="NYSE">NYSE</option><option value="US">ABD</option>
          </select>
        </label>
        {field('maxPe', 'Azami F/K', 'örn. 25')}
        {field('maxPeg', 'Azami PEG', 'örn. 2')}
        {field('maxDebt', 'Azami Borç/Öz.', 'örn. 150')}
        {field('minGrowth', 'Asg. Satış Büy. %', 'örn. 10')}
        {field('minScore', 'Asg. Uzun Vade Skoru', '50')}
      </div>
      <p className="text-xs text-slate-500">
        {ranked.length} yayınlanmış derin analiz adayı değerlendirildi; {matching.length} aday filtreleri geçiyor
        {matching.length > filtered.length ? ` (ilk ${filtered.length} gösteriliyor)` : ''}.
      </p>
      <div className="overflow-x-auto rounded-xl border border-navy-700 bg-navy-900">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="border-b border-navy-700 text-left uppercase tracking-wide text-slate-500"><tr>
            {['Sıra', 'Hisse', 'Pazar', 'Skor', 'F/K', 'PEG', 'Borç/Öz.', 'Satış Büy.', 'Kâr Marjı'].map((label) => <th key={label} className="px-3 py-3 font-medium">{label}</th>)}
          </tr></thead>
          <tbody>{filtered.map((candidate, index) => <tr key={candidate.id} className="border-b border-navy-800 last:border-0">
            <td className="px-3 py-3 text-slate-500">{index + 1}</td>
            <td className="px-3 py-3"><span className="font-bold text-ink">{candidate.symbol}</span><span className="ml-2 text-slate-500">{candidate.companyName}</span></td>
            <td className="px-3 py-3">{candidate.market}</td><td className="px-3 py-3 font-semibold text-accent">{candidate.shortTermScore}/100</td>
            <td className="px-3 py-3">{numberOrDash(candidate.fundamentals?.peRatio)}</td><td className="px-3 py-3">{numberOrDash(candidate.fundamentals?.pegRatio, 2)}</td>
            <td className="px-3 py-3">{numberOrDash(candidate.fundamentals?.debtToEquity)}</td>
            <td className="px-3 py-3">{candidate.fundamentals?.revenueGrowthPct == null ? '—' : formatPercent(candidate.fundamentals.revenueGrowthPct)}</td>
            <td className="px-3 py-3">{candidate.fundamentals?.profitMarginPct == null ? '—' : formatPercent(candidate.fundamentals.profitMarginPct)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink"><BarChart3 size={15} className="text-accent" />Sektör ve Tema Görünümü</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {themes.map((theme) => <div key={theme.slug} className="rounded-xl border border-navy-700 bg-navy-900 p-4">
            <p className="font-semibold text-ink">{theme.name}</p><p className="mt-1 text-xs text-slate-500">{theme.count} şirket · Liderler: {theme.leaders.join(', ') || '—'}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div><p className="text-slate-500">Skor</p><p className="mt-1 font-semibold">{theme.averageScore ?? '—'}</p></div><div><p className="text-slate-500">Kârlı</p><p className="mt-1 font-semibold">{theme.profitableSharePct == null ? '—' : `%${theme.profitableSharePct}`}</p><p className="mt-0.5 text-[9px] text-slate-600">{theme.profitabilityCoverageCount}/{theme.count} veri</p></div><div><p className="text-slate-500">Satış</p><p className="mt-1 font-semibold">{theme.averageSalesGrowthPct == null ? '—' : `%${theme.averageSalesGrowthPct}`}</p><p className="mt-0.5 text-[9px] text-slate-600">{theme.growthCoverageCount}/{theme.count} veri</p></div></div>
          </div>)}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">Tema sınıflaması sektör/endüstri etiketlerinin ilk katmanıdır. Gerçek tedarik zinciri konumu, SEC/KAP belgelerinden kaynaklı şirket-müşteri-tedarikçi grafiği eklendiğinde derinleşecektir.</p>
      </div>
    </div>
  );
}

function FilingsPanel({ defaultScope }) {
  const firstUs = defaultScope.find((item) => item.market !== 'BIST')?.ticker ?? 'AAPL';
  const [symbol, setSymbol] = useState(firstUs);
  const [filings, setFilings] = useState(null);
  const [filingLoading, setFilingLoading] = useState(true);
  const [managers, setManagers] = useState([]);
  const [manager, setManager] = useState('berkshire');
  const [moves, setMoves] = useState(null);
  const [movesLoading, setMovesLoading] = useState(true);
  const filingRequestId = useRef(0);

  async function requestFilings(requestedSymbol) {
    const requestId = ++filingRequestId.current;
    setFilingLoading(true);
    const result = await fetchSecFilings(requestedSymbol);
    if (requestId !== filingRequestId.current) return;
    setFilings(result);
    setFilingLoading(false);
  }

  async function loadFilings(event) {
    event?.preventDefault();
    const requestedSymbol = symbol.trim();
    if (!requestedSymbol) return;
    await requestFilings(requestedSymbol);
  }

  useEffect(() => {
    let active = true;
    fetchInstitutionalManagers().then((result) => {
      if (active) setManagers(result.managers ?? []);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setMovesLoading(true);
    fetchInstitutionalMoves(manager).then((result) => {
      if (!active) return;
      setMoves(result);
      setMovesLoading(false);
    });
    return () => {
      active = false;
    };
  }, [manager]);

  useEffect(() => {
    requestFilings(firstUs);
    return () => {
      filingRequestId.current += 1;
    };
    // İlk kapsam sembolü yalnızca panel açılırken başlangıç değeridir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actionLabel = { new: 'Yeni pozisyon', exited: 'Tam çıkış', increased: 'Artırdı', decreased: 'Azalttı' };
  return (
    <div className="space-y-5">
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><Database size={15} className="text-accent" />SEC EDGAR Bildirimleri</h3>
            <p className="mt-1 text-xs text-slate-500">10-K, 10-Q ve 8-K belgeleri doğrudan resmî SEC kaynağından gelir.</p>
          </div>
          <form onSubmit={loadFilings} className="flex gap-2">
            <label className="sr-only" htmlFor="sec-symbol">ABD hisse kodu</label>
            <input id="sec-symbol" value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} className="w-32 rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm font-semibold text-ink" />
            <button type="submit" disabled={filingLoading || !symbol.trim()} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><Search size={14} />Getir</button>
          </form>
        </div>
        {filingLoading ? (
          <LoadingPanel />
        ) : filings?.error ? (
          <PanelState icon={ShieldAlert} title="SEC verisi alınamadı" body={filings.error} />
        ) : (filings?.filings ?? []).length === 0 ? (
          <PanelState title="Bildirim bulunamadı" body="Seçilen şirket için 10-K, 10-Q veya 8-K kaydı dönmedi." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-navy-700 bg-navy-900">
            <div className="border-b border-navy-700 px-4 py-3"><p className="font-semibold text-ink">{filings.company?.companyName ?? symbol}</p><p className="text-xs text-slate-500">CIK {filings.company?.cik}</p></div>
            <div className="divide-y divide-navy-800">{filings.filings.map((filing) => <a key={filing.accessionNumber} href={filing.documentUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-navy-850"><span className={`rounded-md px-2 py-1 text-[11px] font-bold ${filing.form === '8-K' ? 'bg-amber-400/10 text-amber-400' : 'bg-accent/10 text-accent'}`}>{filing.form}</span><span className="text-xs text-slate-400">{filing.filingDate}</span><span className="min-w-0 flex-1 truncate text-sm text-slate-300">{filing.primaryDocDescription || 'Resmî bildirim'}</span><ExternalLink aria-hidden="true" size={14} className="text-slate-500" /></a>)}</div>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div><h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><Building2 size={15} className="text-accent" />Kurumsal 13F Hareketleri</h3><p className="mt-1 text-xs text-slate-500">Son iki çeyreğin resmî bilgi tabloları CUSIP ve enstrüman türü bazında karşılaştırılır.</p></div>
          <label className="sr-only" htmlFor="institutional-manager">Kurumsal yönetici</label>
          <select id="institutional-manager" value={manager} onChange={(event) => setManager(event.target.value)} className="rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-ink">{managers.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select>
        </div>
        {movesLoading ? (
          <LoadingPanel />
        ) : moves?.error ? (
          <PanelState icon={ShieldAlert} title="13F verisi alınamadı" body={moves.error} />
        ) : (moves?.moves ?? []).length === 0 ? (
          <PanelState title="Hareket bulunamadı" body="Karşılaştırılan iki rapor arasında gösterilecek pozisyon değişimi yok." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-navy-700 bg-navy-900">
            <table className="w-full min-w-[940px] text-xs">
              <thead className="border-b border-navy-700 text-left uppercase tracking-wide text-slate-500"><tr>{['İhraççı', 'CUSIP', 'Tür', 'Hareket', 'Pay Değişimi', 'Değişim %', 'Güncel Değer'].map((label) => <th key={label} className="px-3 py-3 font-medium">{label}</th>)}</tr></thead>
              <tbody>{moves.moves.map((move) => {
                const putCall = String(move.putCall ?? '').toUpperCase();
                const instrumentType = putCall === 'PUT' || putCall === 'CALL' ? putCall : 'Hisse';
                return <tr key={`${move.cusip}:${move.titleOfClass ?? ''}:${putCall}`} className="border-b border-navy-800 last:border-0"><td className="px-3 py-3 font-medium text-ink">{move.issuer}</td><td className="px-3 py-3 text-slate-500">{move.cusip}</td><td className="px-3 py-3"><span className={`rounded px-1.5 py-0.5 font-semibold ${instrumentType === 'Hisse' ? 'bg-navy-800 text-slate-400' : 'bg-amber-400/10 text-amber-400'}`}>{instrumentType}</span></td><td className="px-3 py-3"><span className={move.action === 'new' || move.action === 'increased' ? 'text-gain' : 'text-loss'}>{actionLabel[move.action] ?? move.action}</span></td><td className="px-3 py-3 tabular-nums">{new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1, signDisplay: 'always' }).format(move.changeShares)}</td><td className="px-3 py-3 tabular-nums">{formatPercent(move.changePercent)}</td><td className="px-3 py-3 tabular-nums">{formatCompactUsd(move.valueUsd)}</td></tr>;
              })}</tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-500">13F raporları gecikmeli çeyreklik fotoğraftır; fonun bugünkü pozisyonunu garanti etmez. SEC dosyalarında ticker bulunmadığı için lisanssız eşleştirme uydurulmaz, CUSIP korunur.</p>
      </section>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2"><ProviderCard active title="Guidance / Earnings Release" body="8-K ve ekleri üzerinden resmî şirket açıklamaları izlenebilir; yukarıdaki 8-K satırları doğrudan kaynağa gider." /><ProviderCard active={false} title="Tam Earnings Call Transkripti" body="AlphaSense veya izinli birinci-taraf transcript lisansı henüz bağlı değil. Seeking Alpha içeriği izinsiz taranmaz." /></div>
    </div>
  );
}

function ProviderCard({ active, title, body }) { return <div className="rounded-xl border border-navy-700 bg-navy-900 p-4"><div className="flex items-center gap-2">{active ? <CheckCircle2 size={15} className="text-gain" /> : <CircleDashed size={15} className="text-amber-400" />}<p className="text-sm font-semibold text-ink">{title}</p><span className={`ml-auto rounded px-2 py-0.5 text-[10px] font-semibold ${active ? 'bg-gain/10 text-gain' : 'bg-amber-400/10 text-amber-400'}`}>{active ? 'Aktif' : 'Lisans gerekli'}</span></div><p className="mt-2 text-xs leading-relaxed text-slate-500">{body}</p></div>; }

function MacroPanel({ data }) {
  if (!data) return <LoadingPanel label="BLS ve FED takvimi alınıyor…" />;
  if (data.error) return <PanelState icon={ShieldAlert} title="Makro takvim alınamadı" body={data.error} />;
  return <div className="space-y-4"><div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Metric label="Önümüzdeki 90 gün" value={(data.events ?? []).length} /><Metric label="7 gün içinde" value={(data.events ?? []).filter((event) => { const d = daysUntil(event.date); return d >= 0 && d <= 7; }).length} tone="amber" /><Metric label="Yüksek etkili" value={(data.events ?? []).filter((event) => event.impact === 'high').length} /></div>{data.coverage?.bls === false && <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-400">BLS takvimine geçici olarak ulaşılamadı; FED toplantıları gösterilmeye devam ediyor.</p>}<div className="space-y-2">{(data.events ?? []).map((event) => { const d = daysUntil(event.date); return <a key={event.id} href={event.sourceUrl} target="_blank" rel="noreferrer" className={`flex flex-wrap items-center gap-3 rounded-xl border bg-navy-900 px-4 py-3 transition-colors hover:bg-navy-850 ${d >= 0 && d <= 7 ? 'border-amber-400/40' : 'border-navy-700'}`}><span className="w-16 rounded-md bg-accent/10 px-2 py-1 text-center text-[11px] font-bold text-accent">{event.code}</span><div className="min-w-0 flex-1"><p className="font-medium text-ink">{event.title}</p><p className="text-xs text-slate-500">{event.source}</p></div><div className="text-right"><p className="text-sm font-semibold text-slate-300">{new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul' }).format(new Date(event.date))}</p><p className="text-[11px] text-slate-500">{d === 0 ? 'Bugün' : d > 0 ? `${d} gün sonra` : 'Gerçekleşti'}</p></div><ExternalLink size={14} className="text-slate-500" /></a>; })}</div><p className="text-[11px] text-slate-500">Saatler İstanbul saatine çevrilir. Resmî kaynaklar piyasa konsensüsü yayımlamadığından beklenti değeri gösterilmez; bunun için lisanslı veri sağlayıcı gerekir.</p></div>;
}

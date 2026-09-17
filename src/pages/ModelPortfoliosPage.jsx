import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Check,
  Loader2,
  Plus,
  Shield,
  Target,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import useSyncedState from '../hooks/useSyncedState.js';
import { SEED_WATCHLIST } from '../data/seedWatchlist.js';
import { MOCK_ENABLED } from '../config.js';
import { LAST_UPDATED, MOCK_SHORT_TERM_CANDIDATES } from '../data/mockShortTermCandidates.js';
import { MOCK_LONG_TERM_CANDIDATES } from '../data/mockLongTermCandidates.js';
import {
  fetchLiveCandidates,
  fetchLiveModelPortfolios,
  fetchLiveModelPortfolioTracking,
} from '../services/liveData.js';
import { buildModelPortfolios } from '../utils/modelPortfolioCore.js';
import { formatCurrency, formatPercent } from '../utils/portfolioCalculations.js';
import ModelPortfolioPerformanceChart from '../components/model-portfolios/ModelPortfolioPerformanceChart.jsx';

const RISK_STYLES = {
  1: 'border-gain/30 bg-gain/10 text-gain',
  2: 'border-accent/30 bg-accent/10 text-accent',
  3: 'border-amber-400/30 bg-amber-400/10 text-amber-400',
  4: 'border-loss/30 bg-loss/10 text-loss',
};

const HISTORY_BENCHMARKS = [
  { key: 'sp500', label: 'S&P 500 (TL)' },
  { key: 'nasdaq', label: 'NASDAQ (TL)' },
  { key: 'gold', label: 'Altın (TL)' },
  { key: 'bist100', label: 'BIST 100 (TL)' },
];

function LoadingState() {
  return (
    <div className="flex min-h-[55vh] items-center justify-center gap-2 text-sm text-slate-400">
      <Loader2 size={19} className="animate-spin text-accent" />
      Model portföyler hazırlanıyor…
    </div>
  );
}

export default function ModelPortfoliosPage() {
  const [watchlist, setWatchlist, watchState] = useSyncedState({
    table: 'watchlists',
    column: 'items',
    localKey: 'portfoyai_watchlist',
    seed: SEED_WATCHLIST,
  });
  const [portfolios, setPortfolios] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [trackingError, setTrackingError] = useState(null);
  const [trackingLoading, setTrackingLoading] = useState(true);
  const [source, setSource] = useState('snapshot');

  useEffect(() => {
    let active = true;
    async function load() {
      // Güncel snapshot hızlıca ekrana gelsin; uzun tarihçe sayfaları arka
      // planda okunurken Hazır Portföyler sayfası gereksiz yere bloklanmasın.
      const trackingPromise = fetchLiveModelPortfolioTracking();
      const snapshots = await fetchLiveModelPortfolios();
      if (!active) return;
      const hasSnapshot = snapshots?.length === 4;
      if (hasSnapshot) {
        setSource('snapshot');
        setPortfolios(snapshots);
      }

      const tracked = await trackingPromise;
      if (!active) return;
      setTrackingLoading(false);
      if (tracked?.error) setTrackingError(tracked.error);
      if (tracked?.portfolios?.length === 4) {
        setTracking(tracked);
        setTrackingError(null);
        setSource('tracked');
        setPortfolios(tracked.portfolios);
        return;
      }
      if (hasSnapshot) return;
      const [short, long] = await Promise.all([
        fetchLiveCandidates('short'),
        fetchLiveCandidates('long'),
      ]);
      if (!active) return;
      const shortIsLive = Array.isArray(short?.candidates);
      const longIsLive = Array.isArray(long?.candidates);
      const usesMock = MOCK_ENABLED && (!shortIsLive || !longIsLive);
      const hasCompleteLiveSet = shortIsLive && longIsLive;
      const generatedAt = usesMock
        ? LAST_UPDATED
        : long?.generatedAt ?? short?.generatedAt ?? new Date().toISOString();
      const fallback = buildModelPortfolios({
        shortCandidates: short?.candidates ?? (MOCK_ENABLED ? MOCK_SHORT_TERM_CANDIDATES : []),
        longCandidates: long?.candidates ?? (MOCK_ENABLED ? MOCK_LONG_TERM_CANDIDATES : []),
        generatedAt,
        sourceGeneration: long?.generation ?? short?.generation ?? Date.parse(generatedAt),
      });
      setSource(usesMock ? 'demo' : hasCompleteLiveSet ? 'derived' : 'unavailable');
      setPortfolios(fallback);
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  if (watchState.loading || !portfolios) return <LoadingState />;
  return (
    <ModelPortfoliosContent
      portfolios={portfolios}
      tracking={tracking}
      trackingError={trackingError}
      trackingLoading={trackingLoading}
      source={source}
      watchlist={watchlist}
      setWatchlist={setWatchlist}
    />
  );
}

function ModelPortfoliosContent({
  portfolios,
  tracking,
  trackingError,
  trackingLoading,
  source,
  watchlist,
  setWatchlist,
}) {
  const [activeSlug, setActiveSlug] = useState(portfolios[0]?.slug);
  const [toast, setToast] = useState(null);
  const active = portfolios.find((portfolio) => portfolio.slug === activeSlug) ?? portfolios[0];
  const orderedHoldings = useMemo(
    () =>
      [...active.holdings].sort((a, b) => {
        const rankA = Number(a.modelImportanceRank);
        const rankB = Number(b.modelImportanceRank);
        const validRankA = Number.isInteger(rankA) && rankA > 0;
        const validRankB = Number.isInteger(rankB) && rankB > 0;
        if (validRankA || validRankB) {
          return (validRankA ? rankA : Number.MAX_SAFE_INTEGER) -
            (validRankB ? rankB : Number.MAX_SAFE_INTEGER);
        }
        return (
          Number(b.modelImportanceScore ?? b.opportunityScore ?? 0) -
            Number(a.modelImportanceScore ?? a.opportunityScore ?? 0) ||
          String(a.ticker ?? '').localeCompare(String(b.ticker ?? ''))
        );
      }),
    [active]
  );
  const comparableCurrentNav = useMemo(() => {
    const versionKeys = portfolios.map((portfolio) => portfolio.versionKey).filter(Boolean);
    const expected = new Set(versionKeys);
    const byDate = new Map();
    for (const row of tracking?.navRows ?? []) {
      if (!expected.has(row.version_key)) continue;
      const date = String(row.nav_date ?? '');
      if (!date) continue;
      const rows = byDate.get(date) ?? new Map();
      const previous = rows.get(row.version_key);
      if (!previous || String(row.observed_at ?? '') >= String(previous.observed_at ?? '')) {
        rows.set(row.version_key, row);
      }
      byDate.set(date, rows);
    }
    const date = [...byDate.keys()]
      .sort()
      .reverse()
      .find((candidateDate) => byDate.get(candidateDate)?.size === expected.size);
    return { date: date ?? null, byVersion: date ? byDate.get(date) : new Map() };
  }, [portfolios, tracking]);
  const activeNav = comparableCurrentNav.byVersion.get(active.versionKey) ?? null;
  const watchKeys = useMemo(
    () => new Set(watchlist.map((item) => `${item.market}:${item.ticker}`)),
    [watchlist]
  );

  function toWatchItem(holding, portfolio) {
    return {
      id: crypto.randomUUID(),
      ticker: holding.ticker,
      company: holding.companyName,
      market: holding.market,
      sector: holding.sector,
      currency: holding.currency,
      currentPrice: holding.currentPriceAtGeneration,
      dailyChangePercent: 0,
      targetPrice: holding.target?.price ?? null,
      priceWhenAdded: holding.currentPriceAtGeneration,
      addedAt: new Date().toISOString().slice(0, 10),
      horizon: portfolio.horizon,
      notes: `${portfolio.name} model sepetinden eklendi. Önerilen sepet ağırlığı %${holding.weightPct}.`,
      entryPlan: {
        ...holding.entryPlan,
        sourceGeneratedAt: portfolio.generatedAt,
        validUntil: portfolio.dataFreshUntil ?? portfolio.validUntil,
      },
      modelPortfolio: {
        slug: portfolio.slug,
        versionKey: portfolio.versionKey ?? null,
        sourceGeneration: portfolio.sourceGeneration,
        recommendedWeightPct: holding.weightPct,
        dataFreshUntil: portfolio.dataFreshUntil ?? portfolio.validUntil,
        cycleStart: portfolio.cycleStart ?? null,
        cycleEnd: portfolio.cycleEnd ?? null,
      },
    };
  }

  function addHoldings(holdings) {
    const additions = holdings
      .filter((holding) => !watchKeys.has(`${holding.market}:${holding.ticker}`))
      .map((holding) => toWatchItem(holding, active));
    if (additions.length) setWatchlist((current) => [...current, ...additions]);
    setToast(additions.length ? `${additions.length} hisse takip listesine eklendi.` : 'Bu hisseler zaten takip listesinde.');
    window.setTimeout(() => setToast(null), 2600);
  }

  const generatedText = new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(active.generatedAt));
  const sourceIsActionable = source === 'tracked' || source === 'snapshot' || source === 'derived';
  const dataFreshUntilMs = new Date(active.dataFreshUntil ?? active.validUntil).getTime();
  const entryPlanStale =
    !sourceIsActionable || !Number.isFinite(dataFreshUntilMs) || Date.now() > dataFreshUntilMs;
  const cycleStartMs = new Date(active.cycleStart ?? active.generatedAt).getTime();
  const cycleEndMs = new Date(active.cycleEnd ?? active.validUntil).getTime();
  const cycleIsActive = Number.isFinite(cycleEndMs) && Date.now() < cycleEndMs;
  const daysRemaining = cycleIsActive
    ? Math.max(1, Math.ceil((cycleEndMs - Date.now()) / (24 * 60 * 60 * 1000)))
    : 0;
  const cycleText =
    Number.isFinite(cycleStartMs) && Number.isFinite(cycleEndMs)
      ? `${new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short' }).format(new Date(cycleStartMs))} – ${new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(cycleEndMs))}`
      : 'Dönem bilgisi bekleniyor';
  const sourceLabel = {
    tracked: 'aylık sürümü kilitlenmiş ve günlük NAV ile izlenen resmi model',
    snapshot: 'yayınlanmış model snapshot’ı',
    derived: 'canlı adaylardan tarayıcıda türetilen model',
    demo: 'tarihsel demo adaylarından türetilen, işlem dışı örnek',
    unavailable: 'canlı aday kapsamı doğrulanamadığı için işlem dışı model',
  }[source];
  const freshnessLabel =
    source === 'tracked'
      ? cycleIsActive
        ? `1 aylık dönem · ${daysRemaining} gün kaldı`
        : 'Dönem tamamlandı · yeni sürüm bekleniyor'
      : trackingLoading && source === 'snapshot'
        ? 'Aylık performans geçmişi yükleniyor'
      : source === 'demo'
      ? 'Demo veri · işlem için kullanmayın'
      : source === 'unavailable'
        ? 'Canlı kapsam doğrulanamadı'
        : 'Resmi aylık takip henüz etkin değil';
  const hasCompleteReturnCoverage =
    active.holdings.length > 0 &&
    active.holdings.every(
      (holding) =>
        holding.target?.expectedReturnPct != null &&
        Number.isFinite(Number(holding.target.expectedReturnPct))
    );
  const weightedExpectedReturn = hasCompleteReturnCoverage
    ? Number(
        active.holdings
          .reduce(
            (sum, holding) =>
              sum + Number(holding.target.expectedReturnPct) * (Number(holding.weightPct) / 100),
            0
          )
          .toFixed(1)
      )
    : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink">Hazır Model Portföyler</h2>
          <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
            Dört risk profili, dönem başında sabitlenen ağırlıklarla bir ay boyunca izlenir.
            Yeni dönem; son 30 gündeki 6 saatlik analizlerin konsensüsüyle oluşturulur ve hâlâ
            güçlü kalan hisseler kontrollü biçimde sonraki aya taşınabilir. Dönem içindeki yeni
            taramalar mevcut sepeti değiştirmez.
          </p>
        </div>
        <div className="text-right">
          <span className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs ${cycleIsActive && source === 'tracked' ? 'border-gain/30 bg-gain/10 text-gain' : 'border-amber-400/30 bg-amber-400/10 text-amber-400'}`}>
            <CalendarDays size={13} />
            {freshnessLabel}
          </span>
          <p className="mt-1 text-[11px] text-slate-500">{cycleText}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {portfolios.map((portfolio) => {
          const latestNav = comparableCurrentNav.byVersion.get(portfolio.versionKey);
          const periodReturn = latestNav?.return_pct;
          return (
            <button
              key={portfolio.slug}
              type="button"
              onClick={() => setActiveSlug(portfolio.slug)}
              aria-pressed={active.slug === portfolio.slug}
              className={`rounded-xl border p-4 text-left transition-all ${
                active.slug === portfolio.slug
                  ? 'border-accent bg-accent/5 shadow-sm'
                  : 'border-navy-700 bg-navy-900 hover:border-navy-600'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded-md border px-2 py-1 text-[11px] font-bold ${RISK_STYLES[portfolio.riskTier]}`}>
                  Risk {portfolio.riskTier}/4 · {portfolio.riskLabel}
                </span>
                <span className="text-xs text-slate-500">{portfolio.holdings.length} hisse</span>
              </div>
              <p className="mt-3 font-semibold text-ink">{portfolio.name}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{portfolio.description}</p>
              <div className="mt-3 flex items-end justify-between gap-3 text-xs">
                <span className="text-slate-500">Bu dönem</span>
                <span className={`text-base font-semibold tabular-nums ${periodReturn == null ? 'text-slate-500' : Number(periodReturn) >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {periodReturn == null ? 'Veri birikiyor' : formatPercent(Number(periodReturn))}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {trackingError && (
        <div role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-xs leading-relaxed text-amber-400">
          {trackingError} Güncel sepetler gösteriliyor; performans grafiği için daha sonra yeniden deneyin.
        </div>
      )}

      <ModelPortfolioPerformanceChart
        portfolios={portfolios}
        versions={tracking?.versions ?? []}
        navRows={tracking?.navRows ?? []}
        activeSlug={active.slug}
        trackingStarted={source === 'tracked'}
        trackingLoading={trackingLoading}
        trackingError={trackingError}
      />

      <section className="rounded-xl border border-navy-700 bg-navy-900">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-navy-700 p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-ink">{active.name}</h3>
              <span className={`rounded-md border px-2 py-1 text-[11px] font-bold ${RISK_STYLES[active.riskTier]}`}>
                Risk skoru {active.riskScore}/100
              </span>
              {active.sleeveLimitPct && (
                <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[11px] font-semibold text-amber-400">
                  Toplam sermayenin azami %{active.sleeveLimitPct}'si
                </span>
              )}
              <span className="rounded-md border border-navy-700 bg-navy-800 px-2 py-1 text-[11px] font-semibold text-slate-400">
                Aylık sabit ağırlık
              </span>
              <span className="rounded-md border border-navy-700 bg-navy-800 px-2 py-1 text-[11px] font-semibold text-slate-400">
                {active.selection?.method === 'rolling-30d-consensus-v1'
                  ? `30 günlük konsensüs · ${active.selection.generationCount ?? 0} tarama`
                  : 'Güncel tarama sıralaması'}
              </span>
              {Number(active.selection?.carriedHoldingCount) > 0 && (
                <span className="rounded-md border border-gain/30 bg-gain/10 px-2 py-1 text-[11px] font-semibold text-gain">
                  {active.selection.carriedHoldingCount} hisse önceki aydan taşındı
                </span>
              )}
            </div>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">{active.description}</p>
          </div>
          <button
            type="button"
            onClick={() => addHoldings(orderedHoldings)}
            disabled={!active.holdings.length || entryPlanStale}
            title={entryPlanStale ? 'Giriş seviyeleri altı saatten eski; yeni aday turundaki seviyeleri kontrol edin.' : undefined}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={15} />
            Tümünü Takibe Ekle
          </button>
        </div>

        <div className="grid grid-cols-2 gap-px border-b border-navy-700 bg-navy-700 sm:grid-cols-4">
          <PortfolioMetric icon={WalletCards} label="Nakit" value={`%${active.cashWeightPct}`} />
          <PortfolioMetric
            icon={TrendingUp}
            label="Dönem Fiyat Getirisi"
            value={activeNav?.return_pct == null ? 'Veri birikiyor' : formatPercent(Number(activeNav.return_pct))}
          />
          <PortfolioMetric icon={Target} label="Model Beklentisi" value={weightedExpectedReturn == null ? '—' : formatPercent(weightedExpectedReturn)} />
          <PortfolioMetric icon={Shield} label="Kanıt Gücü" value={active.metrics.convictionScore == null ? '—' : `${active.metrics.convictionScore}/100`} />
        </div>

        {entryPlanStale && source === 'tracked' && (
          <div className="border-b border-navy-700 bg-amber-400/5 px-5 py-3 text-xs leading-relaxed text-amber-400">
            Portföy ve performans takibi dönem sonuna kadar aktiftir; yalnızca gösterilen giriş seviyeleri {generatedText} tarihli olduğu için güncelliğini yitirmiş olabilir.
          </div>
        )}

        {active.warnings.length > 0 && (
          <div className="space-y-1 border-b border-navy-700 bg-amber-400/5 px-5 py-3">
            {active.warnings.map((warning) => (
              <p key={warning} className="text-xs leading-relaxed text-amber-400">• {warning}</p>
            ))}
          </div>
        )}

        {active.holdings.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <Target size={30} className="mx-auto text-slate-500" />
            <p className="mt-3 font-medium text-slate-300">Kalite eşiğini geçen hisse yok</p>
            <p className="mt-1 text-sm text-slate-500">Model, sepeti zayıf hisselerle doldurmak yerine nakitte kalıyor.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-xs">
              <thead className="border-b border-navy-700 text-left uppercase tracking-wide text-slate-500">
                <tr>
                  {['Önem', 'Hisse', 'Ağırlık', 'Dönem Başı Fiyatı', 'Giriş Aralığı', 'Bozulma', 'Hedef', 'Beklenti', 'Risk', 'Gerekçe', 'Takip'].map((label) => (
                    <th key={label} className="px-3 py-3 font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orderedHoldings.map((holding, holdingIndex) => {
                  const inWatchlist = watchKeys.has(`${holding.market}:${holding.ticker}`);
                  const rawImportanceRank = Number(holding.modelImportanceRank);
                  const displayedImportanceRank =
                    Number.isInteger(rawImportanceRank) && rawImportanceRank > 0
                      ? rawImportanceRank
                      : holdingIndex + 1;
                  return (
                    <tr key={`${holding.market}-${holding.ticker}`} className="border-b border-navy-800 align-top last:border-0">
                      <td className="px-3 py-3">
                        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-accent/10 px-1.5 font-bold tabular-nums text-accent">
                          #{displayedImportanceRank}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="font-bold text-ink">{holding.ticker}</span>
                        {holding.carriedFromPrevious && (
                          <span className="ml-1.5 rounded border border-gain/25 bg-gain/10 px-1.5 py-0.5 text-[10px] font-semibold text-gain">
                            Önceki aydan
                          </span>
                        )}
                        <p className="mt-0.5 max-w-40 truncate text-slate-500">{holding.companyName}</p>
                      </td>
                      <td className="px-3 py-3 font-semibold text-accent">%{holding.weightPct}</td>
                      <td className="px-3 py-3 tabular-nums">{formatCurrency(holding.currentPriceAtGeneration, holding.currency)}</td>
                      <td className="px-3 py-3 font-semibold tabular-nums text-gain">{formatCurrency(holding.entryPlan.low, holding.currency)} – {formatCurrency(holding.entryPlan.high, holding.currency)}</td>
                      <td className="px-3 py-3 tabular-nums text-loss">{formatCurrency(holding.entryPlan.invalidation, holding.currency)}</td>
                      <td className="px-3 py-3 tabular-nums">{holding.target.price == null ? '—' : formatCurrency(holding.target.price, holding.currency)}</td>
                      <td className="px-3 py-3 tabular-nums">{holding.target.expectedReturnPct == null ? '—' : formatPercent(holding.target.expectedReturnPct)}</td>
                      <td className="px-3 py-3">{holding.riskLevel}</td>
                      <td className="max-w-64 px-3 py-3 leading-relaxed text-slate-500">{holding.rationale[0] ?? 'Nicel model seçimi.'}</td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => addHoldings([holding])}
                          disabled={inWatchlist || entryPlanStale}
                          className="flex items-center gap-1 rounded-md border border-navy-700 px-2 py-1.5 font-medium text-slate-400 hover:bg-navy-800 disabled:opacity-50"
                        >
                          {inWatchlist ? <Check size={13} /> : <Plus size={13} />}
                          {inWatchlist ? 'Takipte' : 'Ekle'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {tracking && (
        <ModelPortfolioHistory
          slug={active.slug}
          versions={tracking.versions}
          navRows={tracking.navRows}
        />
      )}

      <p className="text-[11px] leading-relaxed text-slate-500">
        Giriş aralığı geçmiş destek davranışından, bozulma seviyesi desteğin altındaki risk payından türetilir; garanti veya emir değildir.
        Ağırlıklı model beklentisi hisse tahminlerinin sepet ağırlıklarıyla katkısını gösterir ve nakit için %0 varsayar; herhangi bir hisse tahmini eksikse değer yayımlanmaz.
        Dönem fiyat getirisi, başlangıçtaki sabit ağırlıklar, günlük fiyatlar ve yabancı varlıklar için kur etkisiyle TL bazında hesaplanır; temettüler dahil değildir ve nakit getirisi %0 kabul edilir.
        Yahoo tarafından bildirilen hisse bölünmesi, ters bölünme ve bedelsiz pay oranları pay adedi çarpanıyla düzeltilir.
        Model önerileri gerçek emir sayılmadığı için doğrudan gerçek portföye yazılmaz. Kaynak: {sourceLabel}.
      </p>

      {toast && (
        <div role="status" aria-live="polite" className="shadow-pop fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-navy-700 bg-navy-900 px-4 py-2.5 text-sm text-ink">
          <Check size={15} className="text-gain" />{toast}
        </div>
      )}
    </div>
  );
}

export function ModelPortfolioHistory({ slug, versions, navRows }) {
  const rows = versions
    .filter((version) => version.slug === slug)
    .sort((a, b) => String(b.cycleStart).localeCompare(String(a.cycleStart)))
    .slice(0, 12);
  const latestByVersion = new Map();
  for (const point of navRows) {
    const previous = latestByVersion.get(point.version_key);
    const dateOrder = String(point.nav_date).localeCompare(String(previous?.nav_date ?? ''));
    if (
      !previous ||
      dateOrder > 0 ||
      (dateOrder === 0 &&
        String(point.observed_at ?? '').localeCompare(String(previous.observed_at ?? '')) > 0)
    ) {
      latestByVersion.set(point.version_key, point);
    }
  }

  return (
    <section className="rounded-xl border border-navy-700 bg-navy-900">
      <div className="border-b border-navy-700 px-5 py-4">
        <h3 className="font-semibold text-ink">Dönem Arşivi · Son 12 dönem</h3>
        <p className="mt-1 text-xs text-slate-500">
          Her sürümün bileşimi dönem başında kilitlenir; önceki dönemler sonradan değiştirilmez.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-sm">
          <thead className="border-b border-navy-700 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Dönem</th>
              <th className="px-4 py-3 font-medium">Durum</th>
              <th className="px-4 py-3 text-right font-medium">Portföy</th>
              {HISTORY_BENCHMARKS.map((benchmark) => (
                <th key={benchmark.key} className="px-4 py-3 text-right font-medium">
                  {benchmark.label}
                </th>
              ))}
              <th className="px-5 py-3 text-right font-medium">Son değerleme</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((version) => {
              const point = latestByVersion.get(version.versionKey);
              const value = point?.return_pct == null ? null : Number(point.return_pct);
              const benchmarkReturns = Object.fromEntries(
                HISTORY_BENCHMARKS.map((benchmark) => {
                  const raw = point?.benchmarks?.[benchmark.key];
                  const numeric = raw == null ? null : Number(raw);
                  return [benchmark.key, Number.isFinite(numeric) ? numeric : null];
                })
              );
              const active = version.status === 'active' && Date.now() < new Date(version.cycleEnd).getTime();
              const formatDate = (valueToFormat) =>
                new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(valueToFormat));
              return (
                <tr key={version.versionKey} className="border-b border-navy-800 last:border-0">
                  <td className="px-5 py-3 font-medium text-ink">
                    {formatDate(version.cycleStart)} – {formatDate(version.cycleEnd)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${active ? 'border-gain/30 bg-gain/10 text-gain' : 'border-navy-700 bg-navy-800 text-slate-500'}`}>
                      {active ? 'Sürüyor' : 'Tamamlandı'}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold tabular-nums ${value == null ? 'text-slate-500' : value >= 0 ? 'text-gain' : 'text-loss'}`}>
                    {value == null ? 'Veri birikiyor' : formatPercent(value)}
                  </td>
                  {HISTORY_BENCHMARKS.map((benchmark) => (
                    <td
                      key={benchmark.key}
                      className={`px-4 py-3 text-right tabular-nums ${
                        benchmarkReturns[benchmark.key] == null
                          ? 'text-slate-500'
                          : benchmarkReturns[benchmark.key] >= 0
                            ? 'text-gain'
                            : 'text-loss'
                      }`}
                    >
                      {benchmarkReturns[benchmark.key] == null
                        ? '—'
                        : formatPercent(benchmarkReturns[benchmark.key])}
                    </td>
                  ))}
                  <td className="px-5 py-3 text-right text-xs text-slate-500">
                    {point?.nav_date
                      ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(`${point.nav_date}T12:00:00Z`))
                      : 'İlk kapanış bekleniyor'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PortfolioMetric({ icon: Icon, label, value }) {
  return (
    <div className="bg-navy-900 px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><Icon size={12} />{label}</p>
      <p className="mt-1 font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

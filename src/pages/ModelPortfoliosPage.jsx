import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Clock,
  Layers3,
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
import { fetchLiveCandidates, fetchLiveModelPortfolios } from '../services/liveData.js';
import { buildModelPortfolios } from '../utils/modelPortfolioCore.js';
import { formatCurrency, formatPercent } from '../utils/portfolioCalculations.js';

const RISK_STYLES = {
  1: 'border-gain/30 bg-gain/10 text-gain',
  2: 'border-accent/30 bg-accent/10 text-accent',
  3: 'border-amber-400/30 bg-amber-400/10 text-amber-400',
  4: 'border-loss/30 bg-loss/10 text-loss',
};

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
  const [source, setSource] = useState('snapshot');

  useEffect(() => {
    let active = true;
    async function load() {
      const snapshots = await fetchLiveModelPortfolios();
      if (!active) return;
      if (snapshots?.length === 4) {
        setPortfolios(snapshots);
        return;
      }
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
      source={source}
      watchlist={watchlist}
      setWatchlist={setWatchlist}
    />
  );
}

function ModelPortfoliosContent({ portfolios, source, watchlist, setWatchlist }) {
  const [activeSlug, setActiveSlug] = useState(portfolios[0]?.slug);
  const [toast, setToast] = useState(null);
  const active = portfolios.find((portfolio) => portfolio.slug === activeSlug) ?? portfolios[0];
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
        validUntil: portfolio.validUntil,
      },
      modelPortfolio: {
        slug: portfolio.slug,
        sourceGeneration: portfolio.sourceGeneration,
        recommendedWeightPct: holding.weightPct,
        validUntil: portfolio.validUntil,
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
  const sourceIsActionable = source === 'snapshot' || source === 'derived';
  const validUntilMs = new Date(active.validUntil).getTime();
  const stale = !sourceIsActionable || !Number.isFinite(validUntilMs) || Date.now() > validUntilMs;
  const sourceLabel = {
    snapshot: 'yayınlanmış model snapshot’ı',
    derived: 'canlı adaylardan tarayıcıda türetilen model',
    demo: 'tarihsel demo adaylarından türetilen, işlem dışı örnek',
    unavailable: 'canlı aday kapsamı doğrulanamadığı için işlem dışı model',
  }[source];
  const freshnessLabel =
    source === 'demo'
      ? 'Demo veri · işlem için kullanmayın'
      : source === 'unavailable'
        ? 'Canlı kapsam doğrulanamadı'
        : stale
          ? 'Yenileme bekleniyor'
          : '6 saatte bir yenilenir';
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
            Aynı fırsat motorundan üretilen dört farklı risk profili. Her hisse için destek tabanlı
            giriş aralığı, kurulumun bozulma seviyesi, hedef ve önerilen sepet ağırlığı gösterilir.
          </p>
        </div>
        <span className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs ${stale ? 'border-amber-400/30 bg-amber-400/10 text-amber-400' : 'border-gain/30 bg-gain/10 text-gain'}`}>
          <Clock size={13} />
          {freshnessLabel} · {generatedText}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {portfolios.map((portfolio) => (
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
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="text-slate-500">Fırsat skoru</span>
              <span className="font-semibold text-accent">{portfolio.metrics.opportunityScore ?? '—'}/100</span>
            </div>
          </button>
        ))}
      </div>

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
            </div>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">{active.description}</p>
          </div>
          <button
            type="button"
            onClick={() => addHoldings(active.holdings)}
            disabled={!active.holdings.length || stale}
            title={stale ? 'Yalnızca güncel ve doğrulanmış model planları takibe eklenebilir.' : undefined}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={15} />
            Tümünü Takibe Ekle
          </button>
        </div>

        <div className="grid grid-cols-2 gap-px border-b border-navy-700 bg-navy-700 sm:grid-cols-4">
          <PortfolioMetric icon={WalletCards} label="Nakit" value={`%${active.cashWeightPct}`} />
          <PortfolioMetric icon={TrendingUp} label="Ağırlıklı Model Beklentisi" value={weightedExpectedReturn == null ? '—' : formatPercent(weightedExpectedReturn)} />
          <PortfolioMetric icon={Shield} label="Kanıt Gücü" value={active.metrics.convictionScore == null ? '—' : `${active.metrics.convictionScore}/100`} />
          <PortfolioMetric icon={Layers3} label="Metodoloji" value="v1" />
        </div>

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
                  {['Hisse', 'Ağırlık', 'Üretim Fiyatı', 'Giriş Aralığı', 'Bozulma', 'Hedef', 'Beklenti', 'Risk', 'Gerekçe', 'Takip'].map((label) => (
                    <th key={label} className="px-3 py-3 font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.holdings.map((holding) => {
                  const inWatchlist = watchKeys.has(`${holding.market}:${holding.ticker}`);
                  return (
                    <tr key={`${holding.market}-${holding.ticker}`} className="border-b border-navy-800 align-top last:border-0">
                      <td className="px-3 py-3"><span className="font-bold text-ink">{holding.ticker}</span><p className="mt-0.5 max-w-40 truncate text-slate-500">{holding.companyName}</p></td>
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
                          disabled={inWatchlist || stale}
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

      <p className="text-[11px] leading-relaxed text-slate-500">
        Giriş aralığı geçmiş destek davranışından, bozulma seviyesi desteğin altındaki risk payından türetilir; garanti veya emir değildir.
        Ağırlıklı model beklentisi hisse tahminlerinin sepet ağırlıklarıyla katkısını gösterir ve nakit için %0 varsayar; herhangi bir hisse tahmini eksikse değer yayımlanmaz.
        Model önerileri gerçekleşmiş işlem sayılmadığı için doğrudan gerçek portföye yazılmaz. Kaynak: {sourceLabel}.
      </p>

      {toast && (
        <div role="status" aria-live="polite" className="shadow-pop fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-navy-700 bg-navy-900 px-4 py-2.5 text-sm text-ink">
          <Check size={15} className="text-gain" />{toast}
        </div>
      )}
    </div>
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

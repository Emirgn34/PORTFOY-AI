import { useEffect, useMemo, useState } from 'react';
import { Trophy, Gauge, Flame, ShieldCheck, Newspaper, SearchX, Clock, Radio, Sparkle, ArrowUpRight, Check } from 'lucide-react';
import useSyncedState from '../hooks/useSyncedState.js';
import { SEED_STOCKS } from '../data/seedPortfolio.js';
import { SEED_WATCHLIST } from '../data/seedWatchlist.js';
import { formatPercent, formatCurrency, getMarketCurrency } from '../utils/portfolioCalculations.js';
import { getScoreColor } from '../utils/opportunityScoring.js';
import {
  MOCK_SHORT_TERM_CANDIDATES,
  LAST_UPDATED,
  VOLUME_SIGNAL_ORDER,
  RISK_ORDER,
} from '../data/mockShortTermCandidates.js';
import { MOCK_LONG_TERM_CANDIDATES } from '../data/mockLongTermCandidates.js';
import { scoreAndRankCandidates, HORIZON_CONFIGS } from '../utils/opportunityScoring.js';
import { fetchLiveCandidates } from '../services/liveData.js';
import ShortTermFilters, { DEFAULT_FILTERS } from '../components/ShortTermFilters.jsx';
import ShortTermCandidateCard from '../components/ShortTermCandidateCard.jsx';
import ShortTermDetailModal from '../components/ShortTermDetailModal.jsx';

const HORIZON_TABS = [
  { value: 'short', label: 'Kısa Vade Fırsatlar' },
  { value: 'long', label: 'Uzun Vade Fırsatlar' },
];

const HORIZON_DESCRIPTIONS = {
  short:
    'Haber katalizörü, teyit durumu, teknik momentum, hacim, likidite ve risk verilerine göre oluşturulan kısa vadeli izleme listesi.',
  long:
    'Temel sağlamlık, değerleme, büyüme görünümü, temettü ve sektör uyumu verilerine göre oluşturulan uzun vadeli izleme listesi.',
};

function SummaryCard({ icon: Icon, label, value, iconBg = 'bg-accent/12 text-accent' }) {
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-900 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
          <Icon size={16} />
        </span>
      </div>
      <p className="mt-3 truncate text-xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

/** "Öne çıkanlar" şeridi için kompakt aday kartı (en güçlü 3 aday). */
function FeaturedCandidate({ candidate, rank, onShowDetail }) {
  const scoreColors = getScoreColor(candidate.shortTermScore);
  const isGainDay = candidate.dailyChangePercent >= 0;
  return (
    <button
      type="button"
      onClick={() => onShowDetail(candidate)}
      className="flex flex-col gap-3 rounded-xl border border-navy-700 border-t-2 bg-navy-900 p-4 text-left transition-colors hover:border-navy-600 hover:bg-navy-850"
      style={{ borderTopColor: scoreColors.stroke }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-navy-800 text-[11px] font-bold text-slate-400">
            #{rank}
          </span>
          <span className="font-bold text-ink">{candidate.symbol}</span>
        </span>
        <span className={`text-2xl font-semibold tabular-nums leading-none ${scoreColors.text}`}>
          {candidate.shortTermScore}
          <span className="text-xs font-medium text-slate-500">/100</span>
        </span>
      </div>
      <p className="truncate text-xs text-slate-500">{candidate.companyName}</p>
      <p className="flex items-start gap-1.5 text-xs font-medium leading-snug text-ink">
        <Sparkle size={12} className="mt-0.5 shrink-0 text-accent-soft" />
        <span className="line-clamp-2">{candidate.strongestCatalystTitle}</span>
      </p>
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="text-xs tabular-nums text-slate-400">
          {formatCurrency(
            candidate.currentPrice,
            candidate.currency ?? getMarketCurrency(candidate.market)
          )}{' '}
          <span className={`font-semibold ${isGainDay ? 'text-gain' : 'text-loss'}`}>
            {formatPercent(candidate.dailyChangePercent)}
          </span>
        </span>
        <span className="flex items-center gap-0.5 text-[11px] font-medium text-accent-soft">
          Detay
          <ArrowUpRight size={12} />
        </span>
      </div>
    </button>
  );
}

export default function OpportunitiesPage() {
  const [portfolioStocks] = useSyncedState({
    table: 'portfolios',
    column: 'stocks',
    localKey: 'portfoyai_stocks',
    seed: SEED_STOCKS,
    readOnly: true,
  });
  // İzleme listesi yazılabilir: kullanıcı bir adayı doğrudan takibe alabilir
  // (WatchlistPage ile aynı bulut tablosu/şema; çok cihaz senkron).
  const [watchlistItems, setWatchlistItems] = useSyncedState({
    table: 'watchlists',
    column: 'items',
    localKey: 'portfoyai_watchlist',
    seed: SEED_WATCHLIST,
  });
  const [horizon, setHorizon] = useState('short');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [justAddedSymbol, setJustAddedSymbol] = useState(null);

  const watchlistTickers = useMemo(
    () => new Set(watchlistItems.map((i) => i.ticker)),
    [watchlistItems]
  );

  /** Bir adayı izleme listesi şemasına çevirip ekler (zaten varsa atlanır). */
  function handleAddToWatchlist(candidate) {
    if (watchlistTickers.has(candidate.symbol)) return;
    const item = {
      id: crypto.randomUUID(),
      ticker: candidate.symbol,
      company: candidate.companyName,
      market: candidate.market,
      sector: candidate.sector,
      currency: candidate.currency ?? getMarketCurrency(candidate.market),
      currentPrice: candidate.currentPrice,
      dailyChangePercent: candidate.dailyChangePercent ?? 0,
      targetPrice: null,
      priceWhenAdded: candidate.currentPrice,
      addedAt: new Date().toISOString().slice(0, 10),
      horizon,
      notes: `Fırsatlar listesinden eklendi (skor ${candidate.shortTermScore}/100).`,
    };
    setWatchlistItems((prev) => [...prev, item]);
    setJustAddedSymbol(candidate.symbol);
    window.setTimeout(() => setJustAddedSymbol((s) => (s === candidate.symbol ? null : s)), 2600);
  }

  // Canlı adaylar bulut tablosundan çekilir; yoksa mock listeye düşülür.
  const [liveShort, setLiveShort] = useState(null);
  const [liveLong, setLiveLong] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [s, l] = await Promise.all([
        fetchLiveCandidates('short'),
        fetchLiveCandidates('long'),
      ]);
      if (cancelled) return;
      if (s?.candidates?.length) setLiveShort(s.candidates);
      if (l?.candidates?.length) setLiveLong(l.candidates);
      // En güncel adayın gerçek üretilme zamanı (bayatlık + katalizör tazeliği bununla ölçülür)
      const times = [s?.generatedAt, l?.generatedAt].filter(Boolean).map((t) => new Date(t).getTime());
      if (times.length) setGeneratedAt(new Date(Math.max(...times)).toISOString());
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const isLive = Boolean(liveShort || liveLong);
  // Katalizör tazeliği ve "son güncelleme" canlıda gerçek üretim anına, mock'ta sabit LAST_UPDATED'a göre.
  const referenceDate = generatedAt ?? LAST_UPDATED;

  // Verinin yaşı (saat); bayatlık uyarısı için. Adaylar ~6 saatte bir üretilir.
  const dataAgeHours = generatedAt
    ? (Date.now() - new Date(generatedAt).getTime()) / 3_600_000
    : null;

  // Skor ve sıra her zaman vadeye uygun ağırlık setiyle breakdown'dan türetilir.
  const rankedShort = useMemo(
    () => scoreAndRankCandidates(liveShort ?? MOCK_SHORT_TERM_CANDIDATES, 'short', referenceDate),
    [liveShort, referenceDate]
  );
  const rankedLong = useMemo(
    () => scoreAndRankCandidates(liveLong ?? MOCK_LONG_TERM_CANDIDATES, 'long', referenceDate),
    [liveLong, referenceDate]
  );

  const rankedCandidates = horizon === 'short' ? rankedShort : rankedLong;

  const portfolioTickers = useMemo(
    () => new Set(portfolioStocks.map((s) => s.ticker)),
    [portfolioStocks]
  );

  const sectors = useMemo(
    () =>
      [...new Set(rankedCandidates.map((c) => c.sector))].sort((a, b) =>
        a.localeCompare(b, 'tr')
      ),
    [rankedCandidates]
  );

  const markets = useMemo(
    () => [...new Set(rankedCandidates.map((c) => c.market))].sort(),
    [rankedCandidates]
  );

  // Özet kartları aktif vadenin tüm listesi üzerinden hesaplanır (filtrelerden bağımsız)
  const summary = useMemo(() => {
    const scores = rankedCandidates.map((c) => c.shortTermScore);
    return {
      topScore: Math.max(...scores),
      avgScore: Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length),
      strongCount: rankedCandidates.filter((c) => c.shortTermScore >= 75).length,
      avgReliability: (
        rankedCandidates.reduce((sum, c) => sum + c.averageNewsReliability, 0) /
        rankedCandidates.length
      ).toFixed(1),
      positiveNewsTotal: rankedCandidates.reduce((sum, c) => sum + c.positiveNewsCount, 0),
    };
  }, [rankedCandidates]);

  const visibleCandidates = useMemo(() => {
    const query = filters.search.trim().toLowerCase();

    const filtered = rankedCandidates.filter((c) => {
      if (filters.market !== 'all' && c.market !== filters.market) return false;
      if (filters.sector !== 'all' && c.sector !== filters.sector) return false;
      if (filters.riskLevel !== 'all' && c.riskLevel !== filters.riskLevel) return false;
      if (filters.sentiment !== 'all' && c.sentiment !== filters.sentiment) return false;
      if (filters.liquidity !== 'all' && c.liquidityLevel !== filters.liquidity) return false;
      if (c.shortTermScore < filters.minScore) return false;
      if (query && !`${c.symbol} ${c.companyName}`.toLowerCase().includes(query)) return false;
      return true;
    });

    const sorters = {
      score: (a, b) => b.shortTermScore - a.shortTermScore,
      reliability: (a, b) => b.averageNewsReliability - a.averageNewsReliability,
      dailyChange: (a, b) => b.dailyChangePercent - a.dailyChangePercent,
      volume: (a, b) =>
        (VOLUME_SIGNAL_ORDER[b.volumeSignal] ?? 0) - (VOLUME_SIGNAL_ORDER[a.volumeSignal] ?? 0),
      risk: (a, b) => (RISK_ORDER[a.riskLevel] ?? 0) - (RISK_ORDER[b.riskLevel] ?? 0),
    };

    return [...filtered].sort(sorters[filters.sortBy] ?? sorters.score);
  }, [rankedCandidates, filters]);

  function handleTabChange(value) {
    setHorizon(value);
    setFilters(DEFAULT_FILTERS); // sektör listeleri vadeye göre değiştiği için filtreler sıfırlanır
  }

  const lastUpdatedText = new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(referenceDate));

  return (
    <div className="space-y-5">
      {/* Başlık + vade sekmeleri */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-ink">Fırsatlar</h2>
        <div data-tour="opp-tabs" className="mt-3 flex overflow-hidden rounded-lg border border-navy-700 sm:inline-flex">
          {HORIZON_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => handleTabChange(tab.value)}
              className={`flex-1 px-4 py-2 text-xs font-medium transition-colors sm:flex-none ${
                horizon === tab.value
                  ? 'bg-accent text-white'
                  : 'text-slate-400 hover:bg-navy-800 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-400">
          {HORIZON_DESCRIPTIONS[horizon]}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {isLive ? (
            <p className={`flex items-center gap-1.5 text-xs ${dataAgeHours != null && dataAgeHours > 8 ? 'text-amber-400' : 'text-gain'}`}>
              <Radio size={12} />
              Canlı veri — {lastUpdatedText} itibarıyla üretildi
              {dataAgeHours != null && (
                <span className="text-slate-500">
                  ({dataAgeHours < 1
                    ? `${Math.max(1, Math.round(dataAgeHours * 60))} dk önce`
                    : `${Math.round(dataAgeHours)} sa önce`}
                  {dataAgeHours > 8 ? ' · güncelleme bekleniyor' : ''})
                </span>
              )}
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Clock size={12} />
              Veriler {lastUpdatedText} itibarıyla — örnek (mock) veri
            </p>
          )}
          <p className="text-xs text-slate-500">
            Bu ekran yatırım tavsiyesi değildir. Sadece veri odaklı izleme ve araştırma amacıyla
            tasarlanmıştır.
          </p>
        </div>
      </div>

      {/* Özet kartları */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          icon={Trophy}
          label="En Yüksek Skor"
          value={`${summary.topScore}/100`}
          iconBg="bg-gain/12 text-gain"
        />
        <SummaryCard
          icon={Gauge}
          label={`Ortalama ${HORIZON_CONFIGS[horizon].label} Skoru`}
          value={`${summary.avgScore}/100`}
        />
        <SummaryCard
          icon={Flame}
          label="Güçlü Potansiyel Aday"
          value={summary.strongCount}
          iconBg="bg-gain/12 text-gain"
        />
        <SummaryCard
          icon={ShieldCheck}
          label="Ort. Haber Güvenilirliği"
          value={`${summary.avgReliability}/10`}
          iconBg="bg-accent/12 text-accent"
        />
        <SummaryCard
          icon={Newspaper}
          label="Pozitif Haber Sayısı"
          value={summary.positiveNewsTotal}
          iconBg="bg-navy-800 text-slate-400"
        />
      </div>

      {/* Öne çıkanlar: skoru en yüksek 3 aday */}
      {rankedCandidates.length >= 3 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Trophy size={15} className="text-accent" />
            <h3 className="text-sm font-semibold text-ink">Öne çıkanlar</h3>
            <span className="text-xs text-slate-500">
              {HORIZON_CONFIGS[horizon].label.toLowerCase()} skoruna göre ilk 3 aday
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rankedCandidates.slice(0, 3).map((candidate) => (
              <FeaturedCandidate
                key={`feat-${candidate.id}`}
                candidate={candidate}
                rank={candidate.rank}
                onShowDetail={setSelectedCandidate}
              />
            ))}
          </div>
        </section>
      )}

      {/* Filtreler */}
      <ShortTermFilters
        filters={filters}
        onFilterChange={(partial) => setFilters((f) => ({ ...f, ...partial }))}
        sectors={sectors}
        markets={markets}
      />

      <p className="text-xs text-slate-500">{visibleCandidates.length} aday gösteriliyor.</p>

      {/* Aday listesi */}
      {visibleCandidates.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-navy-700 bg-navy-900/50 py-16 text-center">
          <SearchX size={36} className="mb-3 text-slate-600" />
          <p className="font-medium text-slate-300">Filtrelere uyan aday bulunamadı</p>
          <p className="mt-1 text-sm text-slate-500">
            Minimum skoru düşürmeyi veya filtreleri sıfırlamayı deneyin.
          </p>
          <button
            type="button"
            onClick={() => setFilters(DEFAULT_FILTERS)}
            className="mt-4 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent-soft transition-colors hover:bg-accent hover:text-white"
          >
            Filtreleri Sıfırla
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleCandidates.map((candidate) => (
            <ShortTermCandidateCard
              key={candidate.id}
              candidate={candidate}
              horizon={horizon}
              isInPortfolio={portfolioTickers.has(candidate.symbol)}
              isInWatchlist={watchlistTickers.has(candidate.symbol)}
              onAddToWatchlist={handleAddToWatchlist}
              onShowDetail={setSelectedCandidate}
            />
          ))}
        </div>
      )}

      <ShortTermDetailModal
        candidate={selectedCandidate}
        horizon={horizon}
        onClose={() => setSelectedCandidate(null)}
      />

      {/* Takibe alma onayı (kısa süreli bildirim) */}
      {justAddedSymbol && (
        <div className="shadow-pop fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-navy-700 bg-navy-900 px-4 py-2.5 text-sm text-ink">
          <Check size={15} className="text-gain" />
          <span className="font-medium">{justAddedSymbol}</span> takip listesine eklendi.
        </div>
      )}
    </div>
  );
}

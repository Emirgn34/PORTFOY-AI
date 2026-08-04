import { useEffect, useMemo, useState } from 'react';
import { Trophy, Gauge, Flame, ShieldCheck, Newspaper, SearchX, Clock, Radio, Sparkle, ArrowUpRight, Check, ShieldQuestion, ChevronDown, ChevronRight, Landmark } from 'lucide-react';
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
import {
  passesConvictionGate,
  getGateFailureReason,
  getConvictionColor,
  CONVICTION_THRESHOLD,
  NEAR_MISS_THRESHOLD,
} from '../utils/conviction.js';

const HORIZON_TABS = [
  { value: 'short', label: 'Kısa Vade Fırsatlar' },
  { value: 'long', label: 'Uzun Vade Fırsatlar' },
];

const HORIZON_DESCRIPTIONS = {
  short:
    'Yalnızca arkasında SOMUT bir olay olan adaylar listelenir: politika/düzenleyici kararı ' +
    'veya analist yükseltmesi gibi gerçekleşmiş bir gelişme, en az bir teknik teyitle birlikte. ' +
    'Eşiği geçen aday yoksa liste bilerek boş bırakılır.',
  long:
    'Temel sağlamlık, değerleme ve büyüme verileriyle sıralanan uzun vadeli adaylar. Vitrine ' +
    'çıkmak için burada da somut bir kanıt (olay + teyit) aranır; skor tek başına yeterli değildir.',
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

/**
 * Vitrin boşken gösterilen dürüst durum kartı.
 *
 * "Bugün kesin fırsat yok" mesajı bilerek bir hata gibi değil, geçerli bir
 * sonuç gibi tasarlandı: kullanıcı listeyi boş gördüğünde sistemin bozulduğunu
 * değil, barın yüksek tutulduğunu anlamalı.
 */
function EmptyState({ icon: Icon, title, body }) {
  return (
    <div className="rounded-xl border border-dashed border-navy-700 bg-navy-900/50 px-6 py-10 text-center">
      <Icon size={32} className="mx-auto mb-3 text-slate-600" />
      <p className="font-medium text-slate-300">{title}</p>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-500">{body}</p>
    </div>
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

  /**
   * Vitrin ayrımı: liste artık "skoru yüksek olanlar" değil, "arkasında somut
   * kanıt olanlar" üzerine kurulu. Skor sıralamayı, kanıt ise vitrine çıkmayı
   * belirler (bkz. src/utils/conviction.js).
   */
  const { certainCandidates, nearMissCandidates, hasConvictionData } = useMemo(() => {
    const withConviction = rankedCandidates.filter((c) => c.conviction);
    const certain = withConviction
      .filter((c) => passesConvictionGate(c.conviction))
      // Vitrin içinde sıralama: önce kanıt gücü, eşitlikte fırsat skoru
      .sort(
        (a, b) => b.conviction.score - a.conviction.score || b.shortTermScore - a.shortTermScore
      );
    const nearMiss = withConviction
      .filter((c) => !passesConvictionGate(c.conviction) && c.conviction.score >= NEAR_MISS_THRESHOLD)
      .sort((a, b) => b.conviction.score - a.conviction.score)
      .slice(0, 3);
    return {
      certainCandidates: certain,
      nearMissCandidates: nearMiss,
      // Aday turu henüz kanıt motoruyla çalışmadıysa liste boş görünür — bu
      // "bugün fırsat yok" DEĞİL "veri henüz üretilmedi" demektir; ikisini
      // birbirine karıştırmamak için ayrı durum tutulur.
      hasConvictionData: withConviction.length > 0,
    };
  }, [rankedCandidates]);

  const [showAllCandidates, setShowAllCandidates] = useState(false);

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
    const convictionScores = rankedCandidates.map((c) => c.conviction?.score ?? 0);
    return {
      topScore: Math.max(...scores),
      avgScore: Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length),
      topConviction: Math.max(0, ...convictionScores),
      withEvidence: rankedCandidates.filter((c) => c.conviction?.evidence?.length > 0).length,
      avgReliability: (
        rankedCandidates.reduce((sum, c) => sum + c.averageNewsReliability, 0) /
        rankedCandidates.length
      ).toFixed(1),
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
              Canlı veri — son güncelleme {lastUpdatedText}
              {dataAgeHours != null && (
                <span className="text-slate-500">
                  ({dataAgeHours < 1
                    ? `${Math.max(1, Math.round(dataAgeHours * 60))} dk önce`
                    : `${Math.round(dataAgeHours)} sa önce`}
                  {dataAgeHours > 8 ? ' · güncelleme bekleniyor' : ''})
                </span>
              )}
              {/* İki hız: olaylar 20 dk'da bir, yapısal analiz 6 saatte bir */}
              <span className="text-slate-500">· haber ve olaylar 20 dakikada bir taranır</span>
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
          icon={Landmark}
          label="Kesin Fırsat"
          value={hasConvictionData ? certainCandidates.length : '—'}
          iconBg="bg-gain/12 text-gain"
        />
        <SummaryCard
          icon={ShieldCheck}
          label="En Yüksek Kanıt Gücü"
          value={hasConvictionData ? `${summary.topConviction}/100` : '—'}
          iconBg="bg-accent/12 text-accent"
        />
        <SummaryCard
          icon={Newspaper}
          label="Kanıt Bulunan Aday"
          value={hasConvictionData ? summary.withEvidence : '—'}
          iconBg="bg-navy-800 text-slate-400"
        />
        <SummaryCard
          icon={Trophy}
          label="En Yüksek Skor"
          value={`${summary.topScore}/100`}
        />
        <SummaryCard
          icon={Gauge}
          label={`Ortalama ${HORIZON_CONFIGS[horizon].label} Skoru`}
          value={`${summary.avgScore}/100`}
        />
      </div>

      {/* KESİN FIRSATLAR — sayfanın ana bölümü */}
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Landmark size={15} className="text-accent" />
          <h3 className="text-sm font-semibold text-ink">Kesin Fırsatlar</h3>
          <span className="text-xs text-slate-500">
            arkasında somut bir olay olan ve en az iki farklı kanıtın doğruladığı adaylar
          </span>
        </div>

        {!hasConvictionData ? (
          <EmptyState
            icon={Clock}
            title="Kanıt taraması henüz çalışmadı"
            body={
              'Bu vadedeki adaylar kanıt motoru devreye girmeden önce üretilmiş. Bir sonraki ' +
              'aday turu (6 saatte bir) tamamlandığında kesin fırsatlar burada listelenecek. ' +
              'O zamana kadar aşağıdaki tam listeyi kullanabilirsin.'
            }
          />
        ) : certainCandidates.length === 0 ? (
          <EmptyState
            icon={ShieldQuestion}
            title="Bugün kesinlik eşiğini geçen fırsat yok"
            body={
              `Taranan adayların hiçbirinde, kanıt gücü ${CONVICTION_THRESHOLD}/100 eşiğini geçen ve ` +
              'en az iki farklı türden kanıtla desteklenen bir kurulum bulunamadı. Bu normal bir ' +
              'sonuçtur: sert ve doğrulanmış olaylar her gün çıkmaz. Zayıf sinyali güçlü gibi ' +
              'göstermemek için liste boş bırakıldı.'
            }
          />
        ) : (
          <div className="space-y-3">
            {certainCandidates.map((candidate) => (
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
      </section>

      {/* Eşiğe yakın adaylar — vitrine giremedi ama sebebiyle birlikte gösterilir */}
      {nearMissCandidates.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <ShieldQuestion size={14} className="text-amber-400" />
            <h3 className="text-sm font-semibold text-slate-300">Eşiğe yakın olanlar</h3>
            <span className="text-xs text-slate-500">kanıtı var ama yeterli değil</span>
          </div>
          <div className="space-y-2">
            {nearMissCandidates.map((candidate) => (
              <button
                key={`near-${candidate.id}`}
                type="button"
                onClick={() => setSelectedCandidate(candidate)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-navy-700 bg-navy-900 px-4 py-3 text-left transition-colors hover:border-navy-600 hover:bg-navy-850"
              >
                <span className="font-semibold text-ink">{candidate.symbol}</span>
                <span
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${getConvictionColor(candidate.conviction.score).badge}`}
                >
                  Kanıt {candidate.conviction.score}/100
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
                  {getGateFailureReason(candidate.conviction)}
                </span>
                <ArrowUpRight size={13} className="shrink-0 text-slate-500" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Tüm taranan adaylar — katlanmış; skor odaklı eski liste burada yaşar */}
      <section>
        <button
          type="button"
          onClick={() => setShowAllCandidates((v) => !v)}
          className="flex w-full items-center gap-2 rounded-lg border border-navy-700 bg-navy-900 px-4 py-3 text-left transition-colors hover:bg-navy-850"
        >
          {showAllCandidates ? (
            <ChevronDown size={15} className="text-slate-400" />
          ) : (
            <ChevronRight size={15} className="text-slate-400" />
          )}
          <span className="text-sm font-medium text-slate-300">
            Taranan tüm adaylar ({rankedCandidates.length})
          </span>
          <span className="ml-auto text-xs text-slate-500">
            kanıt filtresi olmadan, yalnızca skora göre
          </span>
        </button>

        {showAllCandidates && (
          <div className="mt-3 space-y-3">
            <ShortTermFilters
              filters={filters}
              onFilterChange={(partial) => setFilters((f) => ({ ...f, ...partial }))}
              sectors={sectors}
              markets={markets}
            />
            <p className="text-xs text-slate-500">{visibleCandidates.length} aday gösteriliyor.</p>

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
              visibleCandidates.map((candidate) => (
                <ShortTermCandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  horizon={horizon}
                  isInPortfolio={portfolioTickers.has(candidate.symbol)}
                  isInWatchlist={watchlistTickers.has(candidate.symbol)}
                  onAddToWatchlist={handleAddToWatchlist}
                  onShowDetail={setSelectedCandidate}
                />
              ))
            )}
          </div>
        )}
      </section>

      <ShortTermDetailModal
        candidate={selectedCandidate}
        horizon={horizon}
        totalCount={rankedCandidates.length}
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

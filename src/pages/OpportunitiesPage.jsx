import { useMemo, useState } from 'react';
import { Trophy, Gauge, Flame, ShieldCheck, Newspaper, SearchX, Clock } from 'lucide-react';
import useLocalStorage from '../hooks/useLocalStorage.js';
import { SEED_STOCKS } from '../data/seedPortfolio.js';
import {
  MOCK_SHORT_TERM_CANDIDATES,
  LAST_UPDATED,
  VOLUME_SIGNAL_ORDER,
  RISK_ORDER,
} from '../data/mockShortTermCandidates.js';
import { MOCK_LONG_TERM_CANDIDATES } from '../data/mockLongTermCandidates.js';
import { scoreAndRankCandidates, HORIZON_CONFIGS } from '../utils/opportunityScoring.js';
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

function SummaryCard({ icon: Icon, label, value, iconBg = 'bg-accent/15 text-accent-soft' }) {
  return (
    <div className="rounded-xl border border-navy-700/60 bg-navy-900 p-4">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
          <Icon size={19} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs text-slate-400">{label}</p>
          <p className="truncate text-lg font-bold tabular-nums text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}

export default function OpportunitiesPage() {
  const [portfolioStocks] = useLocalStorage('portfoyai_stocks', SEED_STOCKS);
  const [horizon, setHorizon] = useState('short');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [selectedCandidate, setSelectedCandidate] = useState(null);

  // Skor ve sıra her zaman vadeye uygun ağırlık setiyle breakdown'dan türetilir.
  // LAST_UPDATED referans alınır: katalizör tazeliği bu ana göre ölçülür.
  const rankedShort = useMemo(
    () => scoreAndRankCandidates(MOCK_SHORT_TERM_CANDIDATES, 'short', LAST_UPDATED),
    []
  );
  const rankedLong = useMemo(
    () => scoreAndRankCandidates(MOCK_LONG_TERM_CANDIDATES, 'long', LAST_UPDATED),
    []
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
  }).format(new Date(LAST_UPDATED));

  return (
    <div className="space-y-5">
      {/* Başlık + vade sekmeleri */}
      <div>
        <h2 className="text-lg font-bold text-white">Fırsatlar</h2>
        <div className="mt-3 flex overflow-hidden rounded-lg border border-navy-700 sm:inline-flex">
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
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock size={12} />
            Veriler {lastUpdatedText} itibarıyla — örnek (mock) veri
          </p>
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
          iconBg="bg-emerald-300/15 text-emerald-300"
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
          iconBg="bg-gain/15 text-gain"
        />
        <SummaryCard
          icon={ShieldCheck}
          label="Ort. Haber Güvenilirliği"
          value={`${summary.avgReliability}/10`}
          iconBg="bg-violet-400/15 text-violet-300"
        />
        <SummaryCard
          icon={Newspaper}
          label="Pozitif Haber Sayısı"
          value={summary.positiveNewsTotal}
          iconBg="bg-cyan-400/15 text-cyan-300"
        />
      </div>

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
    </div>
  );
}

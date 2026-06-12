import { Search } from 'lucide-react';
import { RISK_LEVELS, LIQUIDITY_LEVELS } from '../data/mockShortTermCandidates.js';

export const SORT_OPTIONS = [
  { value: 'score', label: 'Skora göre' },
  { value: 'reliability', label: 'Haber güvenilirliğine göre' },
  { value: 'dailyChange', label: 'Günlük değişime göre' },
  { value: 'volume', label: 'Hacim sinyaline göre' },
  { value: 'risk', label: 'Risk seviyesine göre' },
];

export const DEFAULT_FILTERS = {
  search: '',
  market: 'all',
  sector: 'all',
  riskLevel: 'all',
  minScore: 0,
  sentiment: 'all',
  liquidity: 'all',
  sortBy: 'score',
};

const SENTIMENT_OPTIONS = [
  { value: 'all', label: 'Tüm Duygular' },
  { value: 'positive', label: 'Pozitif' },
  { value: 'negative', label: 'Negatif' },
  { value: 'neutral', label: 'Nötr' },
];

const MIN_SCORE_OPTIONS = [0, 40, 60, 75, 90];

const selectClass =
  'rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-accent';

export default function ShortTermFilters({ filters, onFilterChange, sectors, markets = [] }) {
  const set = (field) => (e) => onFilterChange({ [field]: e.target.value });

  return (
    <div className="rounded-xl border border-navy-700/60 bg-navy-900 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <div className="relative sm:col-span-2 lg:col-span-1 xl:col-span-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={filters.search}
            onChange={set('search')}
            placeholder="Hisse / şirket ara..."
            className={`${selectClass} w-full pl-9`}
          />
        </div>

        <select value={filters.market} onChange={set('market')} className={selectClass}>
          <option value="all">Tüm Pazarlar</option>
          {markets.map((m) => (
            <option key={m} value={m}>{m === 'BIST' ? 'BIST (Türkiye)' : `${m} (ABD)`}</option>
          ))}
        </select>

        <select value={filters.sector} onChange={set('sector')} className={selectClass}>
          <option value="all">Tüm Sektörler</option>
          {sectors.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select value={filters.riskLevel} onChange={set('riskLevel')} className={selectClass}>
          <option value="all">Tüm Risk Seviyeleri</option>
          {RISK_LEVELS.map((r) => (
            <option key={r} value={r}>Risk: {r}</option>
          ))}
        </select>

        <select
          value={filters.minScore}
          onChange={(e) => onFilterChange({ minScore: Number(e.target.value) })}
          className={selectClass}
        >
          {MIN_SCORE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n === 0 ? 'Tüm Skorlar' : `Min. skor: ${n}`}
            </option>
          ))}
        </select>

        <select value={filters.sentiment} onChange={set('sentiment')} className={selectClass}>
          {SENTIMENT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select value={filters.liquidity} onChange={set('liquidity')} className={selectClass}>
          <option value="all">Tüm Likidite Seviyeleri</option>
          {LIQUIDITY_LEVELS.map((l) => (
            <option key={l} value={l}>Likidite: {l}</option>
          ))}
        </select>

        <select value={filters.sortBy} onChange={set('sortBy')} className={selectClass}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

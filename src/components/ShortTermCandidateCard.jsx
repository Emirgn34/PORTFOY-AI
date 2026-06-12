import { ArrowUp, ArrowDown, Sparkle, HelpCircle, ShieldAlert, Droplets, Gauge, BarChart3, Briefcase, Clock, HandCoins } from 'lucide-react';
import {
  getScoreColor,
  getRiskColor,
  getSentimentIcon,
  getReliabilityColor,
} from '../utils/opportunityScoring.js';
import { formatPercent, formatCurrency, getMarketCurrency } from '../utils/portfolioCalculations.js';

/** Önceki listeye göre sıra değişim göstergesi (↑2 / ↓1 / — / Yeni). */
function RankChange({ rank, previousRank }) {
  if (previousRank == null) {
    return (
      <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-soft">
        Yeni
      </span>
    );
  }
  const delta = previousRank - rank;
  if (delta > 0) {
    return (
      <span className="flex items-center gap-0.5 text-[11px] font-semibold text-gain">
        <ArrowUp size={11} />
        {delta}
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span className="flex items-center gap-0.5 text-[11px] font-semibold text-loss">
        <ArrowDown size={11} />
        {Math.abs(delta)}
      </span>
    );
  }
  return <span className="text-[11px] font-medium text-slate-500">—</span>;
}

/** Pozitif/nötr/negatif haber dağılımını gösteren ince oran çubuğu. */
function SentimentRatioBar({ positive, neutral, negative }) {
  const total = positive + neutral + negative;
  if (total === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-navy-700/70">
        <div className="bg-gain" style={{ width: `${(positive / total) * 100}%` }} />
        <div className="bg-slate-500" style={{ width: `${(neutral / total) * 100}%` }} />
        <div className="bg-loss" style={{ width: `${(negative / total) * 100}%` }} />
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
        <span className="text-gain">{positive}+</span> / {neutral}n /{' '}
        <span className="text-loss">{negative}-</span>
      </span>
    </div>
  );
}

function MetricChip({ icon: Icon, label, value, valueClass = 'text-slate-300' }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-navy-700/60 bg-navy-850 px-2 py-1.5">
      <Icon size={12} className="shrink-0 text-slate-500" />
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className={`ml-auto text-[11px] font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}

export default function ShortTermCandidateCard({ candidate, horizon = 'short', isInPortfolio, onShowDetail }) {
  const scoreColors = getScoreColor(candidate.shortTermScore);
  const reliabilityColors = getReliabilityColor(candidate.averageNewsReliability);
  const sentiment = getSentimentIcon(candidate.sentiment);
  const SentIcon = sentiment.Icon;
  const isGainDay = candidate.dailyChangePercent >= 0;

  return (
    <article
      className="rounded-xl border border-navy-700/60 border-l-4 bg-navy-900 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-navy-600 hover:shadow-lg hover:shadow-black/30 sm:p-5"
      style={{ borderLeftColor: scoreColors.stroke }}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        {/* Sıra + kimlik */}
        <div className="flex items-start gap-3 lg:w-60 lg:shrink-0">
          <div className="flex flex-col items-center gap-1">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-700/70 text-sm font-bold text-white">
              #{candidate.rank}
            </span>
            <RankChange rank={candidate.rank} previousRank={candidate.previousRank} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-bold text-white">{candidate.symbol}</span>
              <span className={`flex h-5 w-5 items-center justify-center rounded ${sentiment.bg} ${sentiment.text}`}>
                <SentIcon size={12} />
              </span>
              {isInPortfolio && (
                <span className="flex items-center gap-1 rounded bg-violet-400/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
                  <Briefcase size={10} />
                  Portföyünüzde
                </span>
              )}
            </div>
            <p className="truncate text-xs text-slate-500">{candidate.companyName}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className="rounded bg-navy-700/60 px-1.5 py-0.5 text-[10px] text-slate-400">
                {candidate.market}
              </span>
              <span className="rounded bg-navy-700/60 px-1.5 py-0.5 text-[10px] text-slate-400">
                {candidate.sector}
              </span>
            </div>
            <p className="mt-1.5 text-sm tabular-nums text-slate-300">
              {formatCurrency(
                candidate.currentPrice,
                candidate.currency ?? getMarketCurrency(candidate.market)
              )}{' '}
              <span className={`text-xs font-semibold ${isGainDay ? 'text-gain' : 'text-loss'}`}>
                {formatPercent(candidate.dailyChangePercent)}
              </span>
            </p>
          </div>
        </div>

        {/* Skor */}
        <div className="flex items-center gap-3 lg:w-44 lg:shrink-0 lg:flex-col lg:items-start lg:gap-1">
          <p className={`text-4xl font-bold tabular-nums leading-none ${scoreColors.text}`}>
            {candidate.shortTermScore}
            <span className="text-base font-medium text-slate-600">/100</span>
          </p>
          <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${scoreColors.badge}`}>
            {candidate.scoreLabel}
          </span>
          {candidate.estimatedHorizon && (
            <span className="flex items-center gap-1 text-[10px] text-slate-500">
              <Clock size={10} />
              Tahmini vade: {candidate.estimatedHorizon}
            </span>
          )}
        </div>

        {/* Katalizör + gerekçe */}
        <div className="min-w-0 flex-1 space-y-2">
          <p className="flex items-start gap-1.5 text-sm font-medium leading-snug text-white">
            <Sparkle size={14} className="mt-0.5 shrink-0 text-accent-soft" />
            <span className="line-clamp-2">{candidate.strongestCatalystTitle}</span>
          </p>
          <p className="line-clamp-2 text-xs leading-relaxed text-slate-400">
            {candidate.reasonShort}
          </p>
          <SentimentRatioBar
            positive={candidate.positiveNewsCount}
            neutral={candidate.neutralNewsCount}
            negative={candidate.negativeNewsCount}
          />
        </div>

        {/* Metrikler + buton */}
        <div className="flex flex-col gap-2 lg:w-72 lg:shrink-0">
          <div className="grid grid-cols-2 gap-1.5">
            <MetricChip
              icon={Gauge}
              label={horizon === 'long' ? 'Trend' : 'Momentum'}
              value={candidate.technicalMomentumLabel}
            />
            {horizon === 'long' ? (
              <MetricChip
                icon={HandCoins}
                label="Temettü"
                value={`%${candidate.dividendYield?.toFixed(1) ?? '—'}`}
              />
            ) : (
              <MetricChip icon={BarChart3} label="Hacim" value={candidate.volumeSignal} />
            )}
            <MetricChip
              icon={ShieldAlert}
              label="Risk"
              value={candidate.riskLevel}
              valueClass={getRiskColor(candidate.riskLevel).split(' ')[1]}
            />
            <MetricChip icon={Droplets} label="Likidite" value={candidate.liquidityLevel} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span
              className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${reliabilityColors.badge}`}
              title="Ortalama haber güvenilirliği"
            >
              Güvenilirlik {candidate.averageNewsReliability.toFixed(1)}/10
            </span>
            <button
              type="button"
              onClick={() => onShowDetail(candidate)}
              className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent-soft transition-colors hover:bg-accent hover:text-white"
            >
              <HelpCircle size={13} />
              Neden bu sırada?
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

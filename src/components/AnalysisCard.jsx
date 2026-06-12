import { Sparkles } from 'lucide-react';
import ScoreBadge from './ScoreBadge.jsx';
import { getScoreColors, RECOMMENDATION_CONFIG } from '../utils/scoreColors.js';

/** SVG halka şeklinde 0-100 skor göstergesi. */
function ScoreRing({ score }) {
  const colors = getScoreColors(score);
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);

  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="#1d2a52" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={colors.stroke}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center text-base font-bold tabular-nums ${colors.text}`}
      >
        {score}
      </span>
    </div>
  );
}

export default function AnalysisCard({ stock, analysis, weightPercent }) {
  const recommendationClass =
    RECOMMENDATION_CONFIG[analysis.recommendation] ?? RECOMMENDATION_CONFIG['Nötr'];

  return (
    <div className="flex flex-col rounded-xl border border-navy-700/60 bg-navy-900 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <ScoreRing score={analysis.overallScore} />
          <div>
            <p className="font-bold text-white">{stock.ticker}</p>
            <p className="text-xs text-slate-500">{stock.company}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Portföy ağırlığı:{' '}
              <span className="font-semibold text-slate-300">{weightPercent.toFixed(1)}%</span>
            </p>
          </div>
        </div>
        <span
          className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${recommendationClass}`}
        >
          {analysis.recommendation}
        </span>
      </div>

      <div className="mb-4 space-y-3">
        <ScoreBadge label="Risk Puanı" score={analysis.riskScore} />
        <ScoreBadge label="Getiri Potansiyeli" score={analysis.returnPotential} />
        <ScoreBadge label="Haber Duyarlılığı" score={analysis.newsSensitivity} />
        <ScoreBadge label="Güvenilir Haber Ortalaması" score={analysis.reliableNewsAvg} max={10} />
      </div>

      <div className="mt-auto rounded-lg border border-navy-700/60 bg-navy-850 p-3">
        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent-soft">
          <Sparkles size={12} />
          AI Yorumu
        </p>
        <p className="text-xs leading-relaxed text-slate-300">{analysis.comment}</p>
      </div>
    </div>
  );
}

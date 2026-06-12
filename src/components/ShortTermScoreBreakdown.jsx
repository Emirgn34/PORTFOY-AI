import { SHORT_TERM_SCORE_WEIGHTS, getScoreColor } from '../utils/opportunityScoring.js';

/**
 * Skor kırılımını ağırlıklarıyla birlikte progress bar olarak gösterir.
 * `weights` prop'u ile kısa veya uzun vade ağırlık seti verilebilir;
 * etiketler ve yüzdeler her zaman formülle senkron kalır.
 */
export default function ShortTermScoreBreakdown({ breakdown, weights = SHORT_TERM_SCORE_WEIGHTS }) {
  return (
    <div className="space-y-3">
      {weights.map(({ key, label, weight }) => {
        const value = breakdown[key] ?? 0;
        const colors = getScoreColor(value);

        return (
          <div key={key}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-400">
                {label}
                <span className="ml-1.5 rounded bg-navy-700/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                  %{Math.round(weight * 100)}
                </span>
              </span>
              <span className={`font-semibold tabular-nums ${colors.text}`}>
                {value}
                <span className="font-normal text-slate-500">/100</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-navy-700/70">
              <div
                className={`h-full rounded-full ${colors.bg} transition-all duration-500`}
                style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

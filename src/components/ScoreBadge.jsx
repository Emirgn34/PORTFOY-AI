import { getScoreColors } from '../utils/scoreColors.js';

/**
 * 0-100 arası bir skoru etiket + renkli bar olarak gösterir.
 * `max` prop'u ile 10 üzerinden skorlar da gösterilebilir.
 */
export default function ScoreBadge({ label, score, max = 100 }) {
  const normalized = max === 100 ? score : (score / max) * 100;
  const colors = getScoreColors(normalized);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className={`font-semibold tabular-nums ${colors.text}`}>
          {max === 100 ? Math.round(score) : score}
          <span className="font-normal text-slate-500">/{max}</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-navy-700/70">
        <div
          className={`h-full rounded-full ${colors.bg} transition-all duration-500`}
          style={{ width: `${Math.min(100, Math.max(0, normalized))}%` }}
        />
      </div>
    </div>
  );
}

import { useState } from 'react';
import { ArrowUpRight, ArrowDownRight, SlidersHorizontal, ChevronDown } from 'lucide-react';

/**
 * "Neden bu sıraya yerleşti?" kartı — sade dille.
 *
 * Ham alt-skorlar yerine her bileşenin sıraya kaç PUAN kattığını gösterir
 * (nötr 50 tabanına göre × ağırlık). Böylece "Likidite 90/100" gibi yüksek ama
 * ağırlığı düşük bir bileşenin aslında az iş yaptığı görünür. Teknik/sayısal
 * anlatım aşağıda katlanır bir bölümde saklı tutulur.
 */
export default function RankExplanationCard({ explanation, technicalDetail }) {
  const [showDetail, setShowDetail] = useState(false);
  if (!explanation) return null;

  const { headline, positives, negatives, adjustments } = explanation;
  const maxPoints = Math.max(
    1,
    ...[...positives, ...negatives].map((c) => Math.abs(c.points))
  );

  return (
    <div className="rounded-lg border border-navy-700/60 bg-navy-850 p-4">
      <p className="text-sm font-medium leading-relaxed text-ink">{headline}</p>

      <div className="mt-4 space-y-3">
        <FactorGroup
          title="Skoru yukarı taşıyanlar"
          Icon={ArrowUpRight}
          items={positives}
          maxPoints={maxPoints}
          tone="gain"
          emptyText="Belirgin şekilde yukarı taşıyan bir bileşen yok."
        />
        <FactorGroup
          title="Skoru aşağı çekenler"
          Icon={ArrowDownRight}
          items={negatives}
          maxPoints={maxPoints}
          tone="loss"
          emptyText="Skoru aşağı çeken belirgin bir bileşen yok."
        />
      </div>

      {adjustments.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-400/25 bg-amber-400/5 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-amber-400">
            <SlidersHorizontal size={12} />
            Skora sonradan uygulanan düzeltmeler
          </p>
          <ul className="space-y-1">
            {adjustments.map((a) => (
              <li key={a} className="text-xs leading-relaxed text-slate-300">
                • {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {technicalDetail && (
        <>
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="mt-3 flex items-center gap-1 text-[11px] font-medium text-slate-400 transition-colors hover:text-accent-soft"
          >
            <ChevronDown
              size={13}
              className={`transition-transform ${showDetail ? 'rotate-180' : ''}`}
            />
            {showDetail ? 'Teknik açıklamayı gizle' : 'Teknik açıklamayı göster (sayısal döküm)'}
          </button>
          {showDetail && (
            <p className="mt-2 border-t border-navy-700/60 pt-2 text-xs leading-relaxed text-slate-400">
              {technicalDetail}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function FactorGroup({ title, Icon, items, maxPoints, tone, emptyText }) {
  const toneText = tone === 'gain' ? 'text-gain' : 'text-loss';
  const toneBg = tone === 'gain' ? 'bg-gain/70' : 'bg-loss/70';

  return (
    <div>
      <p className={`mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide ${toneText}`}>
        <Icon size={12} />
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.key}>
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-ink">{c.label}</span>
                <span className="text-[11px] tabular-nums text-slate-500">{c.value}/100</span>
                <span className={`ml-auto shrink-0 text-[11px] font-semibold tabular-nums ${toneText}`}>
                  {c.points > 0 ? '+' : ''}
                  {c.points} puan
                </span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-navy-700/70">
                <div
                  className={`h-full rounded-full ${toneBg}`}
                  style={{ width: `${(Math.abs(c.points) / maxPoints) * 100}%` }}
                />
              </div>
              {c.meaning && (
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{c.meaning}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

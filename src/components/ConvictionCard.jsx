import {
  Landmark,
  TrendingUp,
  BarChart3,
  Building2,
  ShieldAlert,
  ExternalLink,
  Scale,
} from 'lucide-react';
import {
  EVIDENCE_CATEGORIES,
  getConvictionColor,
  getConvictionLevel,
  summarizeEvidence,
} from '../utils/conviction.js';

const CATEGORY_ICONS = {
  policy: Landmark,
  analyst: TrendingUp,
  technical: BarChart3,
  corporate: Building2,
};

/**
 * "Neden öneriliyor?" kartı — listenin varlık sebebi.
 *
 * Skor kırılımı bir hissenin ne kadar cazip göründüğünü anlatır; bu kart
 * NİÇİN sorusunu somut olayla yanıtlar: kim ne yaptı, ne zaman, kaç kaynak
 * doğruladı ve bu tezin karşısında ne var.
 */
export default function ConvictionCard({ conviction }) {
  if (!conviction || !conviction.evidence?.length) return null;

  const colors = getConvictionColor(conviction.score);
  const level = getConvictionLevel(conviction.score);
  const { evidence, contradictions = [], penalties = [], verdict, verdictRisk } = conviction;

  return (
    <div className="rounded-lg border border-navy-700/60 bg-navy-850 p-4">
      {/* Kanıt gücü + tek cümlelik gerekçe */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-relaxed text-ink">
            {verdict || summarizeEvidence(conviction)}
          </p>
          {verdictRisk && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-amber-200/80">
              <ShieldAlert size={12} className="mt-0.5 shrink-0 text-amber-400" />
              Bu tezi bozabilecek: {verdictRisk}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-2xl font-bold tabular-nums leading-none ${colors.text}`}>
            {conviction.score}
            <span className="text-xs font-medium text-slate-500">/100</span>
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">kanıt gücü</p>
        </div>
      </div>

      <span className={`mt-3 inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${colors.badge}`}>
        {level}
      </span>

      {/* Kanıtlar */}
      <ul className="mt-3 space-y-2.5 border-t border-navy-700/60 pt-3">
        {evidence.map((e, index) => {
          const Icon = CATEGORY_ICONS[e.category] ?? BarChart3;
          const disabled = !EVIDENCE_CATEGORIES[e.category]?.enabled;
          return (
            <li key={`${e.category}-${index}`} className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gain/12 text-gain">
                <Icon size={12} />
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                  <span className="font-semibold uppercase tracking-wide text-slate-400">{e.type}</span>
                  <span>
                    {e.ageDays == null ? 'bugünkü durum' : `${Math.round(e.ageDays)} gün önce`}
                  </span>
                  {e.sourceCount > 1 && e.ageDays != null && (
                    <span className="text-gain">{e.sourceCount} kaynak doğruladı</span>
                  )}
                  {disabled && <span className="text-slate-600">(puana katılmıyor)</span>}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-300">{e.text}</p>
                {e.link && (
                  <a
                    href={e.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-accent-soft hover:underline"
                  >
                    Habere git
                    <ExternalLink size={10} />
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Karşı kanıtlar — tezi zayıflatan her şey açıkça gösterilir */}
      {contradictions.length > 0 && (
        <div className="mt-3 rounded-md border border-loss/25 bg-loss/5 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-loss">
            <Scale size={12} />
            Tezin karşısındaki kanıt
          </p>
          <ul className="mt-1.5 space-y-1">
            {contradictions.map((c, index) => (
              <li key={`c-${index}`} className="text-xs leading-relaxed text-slate-300">
                {c.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Kesinliğin neden kırpıldığı */}
      {penalties.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-navy-700/60 pt-2.5">
          {penalties.map((p) => (
            <li key={p} className="text-[11px] leading-relaxed text-slate-500">
              • {p}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 border-t border-navy-700/60 pt-2.5 text-[11px] leading-relaxed text-slate-500">
        Kanıt gücü, olayın gerçekten yaşandığını ve kaynakların ne kadar sağlam olduğunu ölçer —
        fiyatın tepki vereceğinin garantisi değildir.
      </p>
    </div>
  );
}

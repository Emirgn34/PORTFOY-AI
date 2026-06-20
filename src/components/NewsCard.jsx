import { TrendingUp, TrendingDown, MoveRight, ShieldCheck, Zap, Flame, Briefcase, Eye } from 'lucide-react';
import { getReliabilityColors } from '../utils/scoreColors.js';

function SentimentIcon({ sentiment }) {
  if (sentiment === 'positive') {
    return (
      <span className="flex items-center gap-1.5 text-gain" title="Pozitif haber">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gain/15">
          <TrendingUp size={16} />
        </span>
        <span className="text-xs font-medium">Pozitif</span>
      </span>
    );
  }
  if (sentiment === 'negative') {
    return (
      <span className="flex items-center gap-1.5 text-loss" title="Negatif haber">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-loss/15">
          <TrendingDown size={16} />
        </span>
        <span className="text-xs font-medium">Negatif</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-slate-400" title="Nötr haber">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-navy-800">
        <MoveRight size={16} />
      </span>
      <span className="text-xs font-medium">Nötr</span>
    </span>
  );
}

// Haber tipi rozetleri nötr tutulur; renk sinyali duygu ve öneme ayrılır
// (KAP resmi bildirim olduğu için hafif vurgulanır).
const TYPE_BADGE_COLORS = {
  'KAP': 'bg-accent/12 text-accent-soft',
  'Genel Haber': 'bg-navy-800 text-slate-500',
};
const DEFAULT_TYPE_BADGE = 'bg-navy-800 text-slate-500';

export default function NewsCard({ news, onClick }) {
  const reliabilityColors = getReliabilityColors(news.reliability);
  const formattedDate = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(
    new Date(news.date)
  );

  const isHighImpact = news.importanceLevel === 'high';

  // Yüksek önemli ve katalizörlü haberler sakin bir amber/yeşil şeritle vurgulanır
  const borderClass = isHighImpact
    ? 'border-accent/40 hover:border-accent/60'
    : news.isCatalyst
      ? 'border-amber-400/35 hover:border-amber-400/55'
      : 'border-navy-700 hover:border-navy-600';

  return (
    <article
      onClick={() => onClick(news)}
      className={`group flex cursor-pointer flex-col rounded-xl border bg-navy-900 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-pop ${borderClass}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-navy-800 px-2 py-0.5 text-xs font-bold text-ink">
          {news.ticker}
        </span>
        {news.relevance === 'portfolio' && (
          <span
            className="flex items-center gap-0.5 rounded bg-accent/12 px-1.5 py-0.5 text-[10px] font-semibold text-accent-soft"
            title="Portföyündeki bir hisseyle ilgili"
          >
            <Briefcase size={9} />
            Portföyünde
          </span>
        )}
        {news.relevance === 'watchlist' && (
          <span
            className="flex items-center gap-0.5 rounded bg-navy-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400"
            title="Takip listendeki bir hisseyle ilgili"
          >
            <Eye size={9} />
            Takipte
          </span>
        )}
        {isHighImpact && (
          <span
            className="flex items-center gap-0.5 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400"
            title="Yüksek önem: güvenilir kaynak, güçlü etki veya portföy ilgisi"
          >
            <Flame size={9} />
            Yüksek etki
          </span>
        )}
        {news.isCatalyst && !isHighImpact && (
          <span
            className="flex items-center gap-0.5 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400"
            title="Gelecekte fiyatı olumlu etkileyebilecek katalizör içerebilir"
          >
            <Zap size={9} />
            Katalizör
          </span>
        )}
        {news.isLive && (
          <span className="rounded bg-gain/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-gain">
            CANLI
          </span>
        )}
        <span className="truncate text-xs text-slate-500">{news.company}</span>
        <span
          className={`ml-auto rounded-md px-2 py-0.5 text-[11px] font-medium ${
            TYPE_BADGE_COLORS[news.type] ?? DEFAULT_TYPE_BADGE
          }`}
        >
          {news.type}
        </span>
      </div>

      <h3 className="mb-1.5 line-clamp-2 text-sm font-semibold leading-snug text-ink group-hover:text-accent-soft">
        {news.title}
      </h3>
      <p className="mb-3 line-clamp-3 text-xs leading-relaxed text-slate-400">{news.summary}</p>

      <div className="mb-3 mt-auto flex items-center gap-2 text-[11px] text-slate-500">
        <span>{news.source}</span>
        <span className="text-slate-700">•</span>
        <span>{formattedDate}</span>
      </div>

      <div className="flex items-end justify-between border-t border-navy-800 pt-3">
        <SentimentIcon sentiment={news.sentiment} />
        <span
          className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold ${reliabilityColors.badge}`}
          title="Güvenilirlik puanı"
        >
          <ShieldCheck size={13} />
          {news.reliability}/10
        </span>
      </div>
    </article>
  );
}

export { SentimentIcon, TYPE_BADGE_COLORS };

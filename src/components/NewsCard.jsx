import { TrendingUp, TrendingDown, MoveRight, ShieldCheck, Zap } from 'lucide-react';
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
    <span className="flex items-center gap-1.5 text-amber-300/80" title="Nötr haber">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-300/10">
        <MoveRight size={16} />
      </span>
      <span className="text-xs font-medium">Nötr</span>
    </span>
  );
}

const TYPE_BADGE_COLORS = {
  'Anlaşma': 'bg-accent/15 text-accent-soft',
  'Bilanço': 'bg-violet-400/15 text-violet-300',
  'Yatırım': 'bg-cyan-400/15 text-cyan-300',
  'Ortaklık': 'bg-fuchsia-400/15 text-fuchsia-300',
  'KAP': 'bg-sky-400/15 text-sky-300',
  'Genel Haber': 'bg-slate-400/15 text-slate-300',
};

export default function NewsCard({ news, onClick }) {
  const reliabilityColors = getReliabilityColors(news.reliability);
  const formattedDate = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(
    new Date(news.date)
  );

  // Potansiyel pozitif katalizör haberleri çok hafif turuncu şeritle vurgulanır
  const borderClass = news.isCatalyst
    ? 'border-orange-400/35 hover:border-orange-400/60 hover:shadow-orange-400/5'
    : 'border-navy-700/60 hover:border-accent/40 hover:shadow-accent/5';

  return (
    <article
      onClick={() => onClick(news)}
      className={`group flex cursor-pointer flex-col rounded-xl border bg-navy-900 p-4 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${borderClass}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-navy-700/70 px-2 py-0.5 text-xs font-bold text-white">
          {news.ticker}
        </span>
        {news.isLive && (
          <span className="rounded bg-gain/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-gain">
            CANLI
          </span>
        )}
        {news.isCatalyst && (
          <span
            className="flex items-center gap-0.5 rounded bg-orange-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-orange-300"
            title="Gelecekte fiyatı olumlu etkileyebilecek katalizör içerebilir"
          >
            <Zap size={9} />
            Katalizör
          </span>
        )}
        <span className="truncate text-xs text-slate-500">{news.company}</span>
        <span
          className={`ml-auto rounded-md px-2 py-0.5 text-[11px] font-medium ${
            TYPE_BADGE_COLORS[news.type] ?? TYPE_BADGE_COLORS['Genel Haber']
          }`}
        >
          {news.type}
        </span>
      </div>

      <h3 className="mb-1.5 line-clamp-2 text-sm font-semibold leading-snug text-white group-hover:text-accent-soft">
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

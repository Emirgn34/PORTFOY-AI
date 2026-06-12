import { X, ShieldCheck, CheckCircle2, Info, AlertTriangle, ExternalLink } from 'lucide-react';
import { getReliabilityColors, SENTIMENT_CONFIG } from '../utils/scoreColors.js';
import { TYPE_BADGE_COLORS } from './NewsCard.jsx';

function Section({ title, icon: Icon, children }) {
  return (
    <section>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {Icon && <Icon size={14} />}
        {title}
      </h4>
      {children}
    </section>
  );
}

export default function NewsDetailModal({ news, onClose }) {
  if (!news) return null;

  const reliabilityColors = getReliabilityColors(news.reliability);
  const sentiment = SENTIMENT_CONFIG[news.sentiment];
  const formattedDate = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long' }).format(
    new Date(news.date)
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-navy-700 bg-navy-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-navy-700/60 bg-navy-900 px-5 py-4">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-navy-700/70 px-2 py-0.5 text-xs font-bold text-white">
                {news.ticker}
              </span>
              <span className="text-xs text-slate-500">{news.company}</span>
              <span
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                  TYPE_BADGE_COLORS[news.type] ?? TYPE_BADGE_COLORS['Genel Haber']
                }`}
              >
                {news.type}
              </span>
              <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${sentiment.badge}`}>
                {sentiment.label}
              </span>
            </div>
            <h2 className="text-base font-semibold leading-snug text-white">{news.title}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {news.source} • {formattedDate}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-navy-800 hover:text-white"
            aria-label="Kapat"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <Section title="Haber Metni">
            <p className="text-sm leading-relaxed text-slate-300">{news.content}</p>
            {news.link && (
              <a
                href={news.link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent-soft transition-colors hover:bg-accent hover:text-white"
              >
                <ExternalLink size={13} />
                Haberin kaynağına git
              </a>
            )}
          </Section>

          <Section title="Güvenilirlik Değerlendirmesi" icon={ShieldCheck}>
            <div className="rounded-lg border border-navy-700/60 bg-navy-850 p-4">
              <div className="mb-3 flex items-center gap-3">
                <span
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-bold ${reliabilityColors.badge}`}
                >
                  <ShieldCheck size={15} />
                  {news.reliability}/10
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-navy-700/70">
                  <div
                    className={`h-full rounded-full ${reliabilityColors.bg}`}
                    style={{ width: `${news.reliability * 10}%` }}
                  />
                </div>
              </div>
              <p className="text-xs font-medium text-slate-400">
                Neden bu güvenilirlik puanı verildi?
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-300">
                {news.reliabilityReason}
              </p>
            </div>
          </Section>

          <Section title="Duygu Değerlendirmesi" icon={Info}>
            <div className="rounded-lg border border-navy-700/60 bg-navy-850 p-4">
              <p className={`mb-1 text-sm font-semibold ${sentiment.text}`}>{sentiment.label}</p>
              <p className="text-sm leading-relaxed text-slate-300">
                {news.sentimentExplanation}
              </p>
            </div>
          </Section>

          <Section title="Teyit Edilen Kaynaklar" icon={CheckCircle2}>
            <ul className="flex flex-wrap gap-2">
              {news.confirmedSources.map((source) => (
                <li
                  key={source}
                  className="flex items-center gap-1.5 rounded-lg border border-navy-700/60 bg-navy-850 px-2.5 py-1 text-xs text-slate-300"
                >
                  <CheckCircle2 size={13} className="text-gain" />
                  {source}
                </li>
              ))}
            </ul>
          </Section>

          <div className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
            <p className="text-xs leading-relaxed text-amber-200/80">
              Bu haber henüz yatırım tavsiyesi değildir, sadece bilgi amaçlıdır.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

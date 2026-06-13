import { useMemo } from 'react';
import { Gauge, Sparkles, FlaskConical, Inbox } from 'lucide-react';
import useSyncedState from '../hooks/useSyncedState.js';
import { SEED_STOCKS } from '../data/seedPortfolio.js';
import { MOCK_PORTFOLIO_ANALYSIS, getStockAnalysis } from '../data/mockAnalysis.js';
import AnalysisCard from '../components/AnalysisCard.jsx';
import ScoreBadge from '../components/ScoreBadge.jsx';
import { getScoreColors, RISK_LEVEL_CONFIG } from '../utils/scoreColors.js';
import { getStockMetrics, toTRY } from '../utils/portfolioCalculations.js';

/** Büyük SVG halka — genel portföy skoru. */
function PortfolioScoreRing({ score }) {
  const colors = getScoreColors(score);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);

  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 128 128" className="h-32 w-32 -rotate-90">
        <circle cx="64" cy="64" r={radius} fill="none" stroke="#1d2a52" strokeWidth="10" />
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke={colors.stroke}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-bold tabular-nums ${colors.text}`}>{score}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">/ 100</span>
      </div>
    </div>
  );
}

export default function AnalysisPage() {
  const [stocks] = useSyncedState({
    table: 'portfolios',
    column: 'stocks',
    localKey: 'portfoyai_stocks',
    seed: SEED_STOCKS,
    readOnly: true,
  });
  const analysis = MOCK_PORTFOLIO_ANALYSIS;

  // Her hissenin TRY bazlı portföy ağırlığı
  const weights = useMemo(() => {
    const values = stocks.map((s) => toTRY(getStockMetrics(s).currentValue, s.currency));
    const total = values.reduce((sum, v) => sum + v, 0);
    return stocks.map((s, i) => ({
      stock: s,
      weightPercent: total > 0 ? (values[i] / total) * 100 : 0,
    }));
  }, [stocks]);

  const riskClass = RISK_LEVEL_CONFIG[analysis.riskLevel] ?? RISK_LEVEL_CONFIG['Orta'];

  return (
    <div className="space-y-6">
      {/* Bilgilendirme notu */}
      <div className="flex items-start gap-2 rounded-lg border border-accent/20 bg-accent/5 p-3">
        <FlaskConical size={15} className="mt-0.5 shrink-0 text-accent-soft" />
        <p className="text-xs leading-relaxed text-slate-400">
          Analiz mantığı yakında eklenecek. Aşağıdaki skorlar örnek verilerle oluşturulmuştur;
          gerçek AI analiz motoru bağlandığında bu sayfa canlı değerlendirmeler gösterecektir.
        </p>
      </div>

      {/* Genel portföy skoru */}
      <div data-tour="analysis-score" className="rounded-xl border border-navy-700/60 bg-navy-900 p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
          <div className="flex items-center gap-5">
            <PortfolioScoreRing score={analysis.overallScore} />
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-white">
                <Gauge size={18} className="text-accent-soft" />
                Genel Portföy Skoru
              </h2>
              <p className="mt-1 text-xs text-slate-500">100 üzerinden değerlendirme</p>
              <span
                className={`mt-3 inline-block rounded-lg border px-2.5 py-1 text-xs font-semibold ${riskClass}`}
              >
                Risk Seviyesi: {analysis.riskLevel}
              </span>
            </div>
          </div>

          <div className="grid flex-1 grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <ScoreBadge label="Çeşitlendirme Skoru" score={analysis.diversificationScore} />
            <ScoreBadge label="Haber Etkisi Skoru" score={analysis.newsImpactScore} />
            <ScoreBadge label="Temel Analiz Skoru" score={analysis.fundamentalScore} />
            <ScoreBadge label="Teknik Görünüm Skoru" score={analysis.technicalScore} />
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-navy-700/60 bg-navy-850 p-4">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent-soft">
            <Sparkles size={12} />
            Genel Yorum
          </p>
          <p className="text-sm leading-relaxed text-slate-300">{analysis.comment}</p>
        </div>
      </div>

      {/* Hisse bazlı analiz kartları */}
      <div>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Hisse Bazlı Analiz
        </h2>
        {stocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-navy-700 bg-navy-900/50 py-16 text-center">
            <Inbox size={36} className="mb-3 text-slate-600" />
            <p className="font-medium text-slate-300">Analiz edilecek hisse yok</p>
            <p className="mt-1 text-sm text-slate-500">
              Portföyüm sayfasından hisse ekleyince analizler burada görünecek.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {weights.map(({ stock, weightPercent }) => (
              <AnalysisCard
                key={stock.id}
                stock={stock}
                analysis={getStockAnalysis(stock.ticker)}
                weightPercent={weightPercent}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

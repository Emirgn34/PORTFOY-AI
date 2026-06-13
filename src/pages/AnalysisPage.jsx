import { useEffect, useMemo, useState } from 'react';
import { Gauge, Sparkles, FlaskConical, Inbox, Loader2, RefreshCw, BrainCircuit } from 'lucide-react';
import useSyncedState from '../hooks/useSyncedState.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { SEED_STOCKS } from '../data/seedPortfolio.js';
import { MOCK_PORTFOLIO_ANALYSIS, getStockAnalysis } from '../data/mockAnalysis.js';
import { loadCachedAnalysis, runAnalysis } from '../services/analysis.js';
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
  const { configured } = useAuth();
  const [result, setResult] = useState(null); // gerçek analiz (kayıtlı veya yeni)
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  // Açılışta kullanıcının kayıtlı analizini yükle (AI çağrısı yapmadan)
  useEffect(() => {
    if (!configured) return undefined;
    let active = true;
    loadCachedAnalysis().then((a) => {
      if (active && a) setResult(a);
    });
    return () => {
      active = false;
    };
  }, [configured]);

  async function handleRun() {
    if (stocks.length === 0) return;
    setGenerating(true);
    setError(null);
    try {
      setResult(await runAnalysis(stocks));
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  // Gerçek analiz varsa onu, yoksa örnek (mock) veriyi kullan
  const isReal = Boolean(result);
  const portfolio = result?.portfolio ?? MOCK_PORTFOLIO_ANALYSIS;
  const getAnalysis = (ticker) =>
    result?.stocks?.[ticker.toUpperCase()] ?? getStockAnalysis(ticker);

  // Her hissenin TRY bazlı portföy ağırlığı
  const weights = useMemo(() => {
    const values = stocks.map((s) => toTRY(getStockMetrics(s).currentValue, s.currency));
    const total = values.reduce((sum, v) => sum + v, 0);
    return stocks.map((s, i) => ({
      stock: s,
      weightPercent: total > 0 ? (values[i] / total) * 100 : 0,
    }));
  }, [stocks]);

  const riskClass = RISK_LEVEL_CONFIG[portfolio.riskLevel] ?? RISK_LEVEL_CONFIG['Orta'];
  const updatedText = result?.generatedAt
    ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(result.generatedAt)
      )
    : null;

  return (
    <div className="space-y-6">
      {/* Analiz durumu + çalıştırma */}
      <div className="flex flex-col gap-3 rounded-lg border border-accent/20 bg-accent/5 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          {isReal ? (
            <Sparkles size={15} className="mt-0.5 shrink-0 text-accent-soft" />
          ) : (
            <FlaskConical size={15} className="mt-0.5 shrink-0 text-accent-soft" />
          )}
          <p className="text-xs leading-relaxed text-slate-400">
            {isReal ? (
              <>
                Bu değerlendirme portföyünün <span className="text-slate-200">gerçek piyasa verisi</span>
                {result?.aiUsed ? ' ve AI (Haiku 4.5) yorumuyla' : ''} oluşturuldu.
                {updatedText && <> Son güncelleme: {updatedText}.</>}
              </>
            ) : (
              <>
                Aşağıdaki skorlar <span className="text-slate-200">örnek (mock)</span> verilerdir.
                Portföyüne özel gerçek değerlendirme için <span className="text-accent-soft">Portföyümü Analiz Et</span>'e bas.
              </>
            )}
          </p>
        </div>
        {configured && (
          <button
            type="button"
            onClick={handleRun}
            disabled={generating || stocks.length === 0}
            className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generating ? <Loader2 size={15} className="animate-spin" /> : isReal ? <RefreshCw size={15} /> : <BrainCircuit size={15} />}
            {generating ? 'Analiz ediliyor…' : isReal ? 'Yenile' : 'Portföyümü Analiz Et'}
          </button>
        )}
      </div>
      {error && (
        <p className="rounded-lg border border-loss/30 bg-loss/10 px-3 py-2 text-xs text-loss">{error}</p>
      )}

      {/* Genel portföy skoru */}
      <div data-tour="analysis-score" className="rounded-xl border border-navy-700/60 bg-navy-900 p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
          <div className="flex items-center gap-5">
            <PortfolioScoreRing score={portfolio.overallScore} />
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-white">
                <Gauge size={18} className="text-accent-soft" />
                Genel Portföy Skoru
              </h2>
              <p className="mt-1 text-xs text-slate-500">100 üzerinden değerlendirme</p>
              <span
                className={`mt-3 inline-block rounded-lg border px-2.5 py-1 text-xs font-semibold ${riskClass}`}
              >
                Risk Seviyesi: {portfolio.riskLevel}
              </span>
            </div>
          </div>

          <div className="grid flex-1 grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <ScoreBadge label="Çeşitlendirme Skoru" score={portfolio.diversificationScore} />
            <ScoreBadge label="Haber Etkisi Skoru" score={portfolio.newsImpactScore} />
            <ScoreBadge label="Temel Analiz Skoru" score={portfolio.fundamentalScore} />
            <ScoreBadge label="Teknik Görünüm Skoru" score={portfolio.technicalScore} />
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-navy-700/60 bg-navy-850 p-4">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent-soft">
            <Sparkles size={12} />
            Genel Yorum
          </p>
          <p className="text-sm leading-relaxed text-slate-300">{portfolio.comment}</p>
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
                analysis={getAnalysis(stock.ticker)}
                weightPercent={weightPercent}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import {
  X,
  Sparkle,
  ListOrdered,
  Newspaper,
  CheckCircle2,
  XCircle,
  Gauge,
  BarChart3,
  AlertTriangle,
  ShieldCheck,
  Info,
  ExternalLink,
} from 'lucide-react';
import ShortTermScoreBreakdown from './ShortTermScoreBreakdown.jsx';
import {
  getScoreColor,
  getRiskColor,
  getSentimentIcon,
  getReliabilityColor,
  HIGH_RISK_SCORE_CAP,
  RELIABILITY_GATE_THRESHOLD,
  HORIZON_CONFIGS,
} from '../utils/opportunityScoring.js';
import { formatPercent, formatCurrency, getMarketCurrency } from '../utils/portfolioCalculations.js';

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

const boxClass = 'rounded-lg border border-navy-700/60 bg-navy-850 p-4';

export default function ShortTermDetailModal({ candidate, horizon = 'short', onClose }) {
  if (!candidate) return null;

  const horizonConfig = HORIZON_CONFIGS[horizon];
  const scoreColors = getScoreColor(candidate.shortTermScore);
  const sentiment = getSentimentIcon(candidate.sentiment);
  const reliabilityColors = getReliabilityColor(candidate.averageNewsReliability);
  const confirmedCount = candidate.verifiedSources.filter((s) => s.isConfirmed).length;
  const isLive = Boolean(candidate.id?.startsWith('live-'));
  const formatDate = (d) =>
    new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(d));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-navy-700 bg-navy-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. Hisse genel bilgisi + 2. skor */}
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-navy-700/60 bg-navy-900 px-5 py-4">
          <div className="flex items-center gap-4">
            <p className={`text-4xl font-bold tabular-nums ${scoreColors.text}`}>
              {candidate.shortTermScore}
              <span className="text-sm font-medium text-slate-600">/100</span>
            </p>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-ink">{candidate.symbol}</span>
                <span className="text-xs text-slate-500">{candidate.companyName}</span>
                <span className="rounded bg-navy-700/60 px-1.5 py-0.5 text-[10px] text-slate-400">
                  {candidate.market} • {candidate.sector}
                </span>
              </div>
              <p className="mt-0.5 text-xs tabular-nums text-slate-400">
                {formatCurrency(
                  candidate.currentPrice,
                  candidate.currency ?? getMarketCurrency(candidate.market)
                )}{' '}
                <span className={candidate.dailyChangePercent >= 0 ? 'text-gain' : 'text-loss'}>
                  {formatPercent(candidate.dailyChangePercent)}
                </span>
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${scoreColors.badge}`}>
                  {candidate.scoreLabel}
                </span>
                <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${getRiskColor(candidate.riskLevel)}`}>
                  Risk: {candidate.riskLevel}
                </span>
                <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${sentiment.bg} ${sentiment.text} border-transparent`}>
                  {sentiment.label}
                </span>
                {candidate.estimatedHorizon && (
                  <span className="rounded-md border border-navy-700 bg-navy-800 px-2 py-0.5 text-[11px] font-medium text-slate-300">
                    Tahmini vade: {candidate.estimatedHorizon}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-navy-800 hover:text-ink"
            aria-label="Kapat"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {/* 3. Skor kırılımı */}
          <Section title={`Skor Kırılımı (${horizonConfig.label})`} icon={Gauge}>
            <div className={boxClass}>
              <ShortTermScoreBreakdown
                breakdown={candidate.scoreBreakdown}
                weights={horizonConfig.weights}
              />
            </div>
          </Section>

          {/* 4. Neden bu hisse seçildi? */}
          <Section title="Neden Bu Hisse Seçildi?" icon={Sparkle}>
            <div className={boxClass}>
              <p className="text-sm font-medium text-ink">{candidate.strongestCatalystTitle}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                Katalizör tarihi: {formatDate(candidate.catalystDate)}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                {candidate.strongestCatalystSummary}
              </p>
            </div>
          </Section>

          {/* 5. Neden bu sıraya yerleşti? */}
          <Section title="Neden Bu Sıraya Yerleşti?" icon={ListOrdered}>
            <div className={boxClass}>
              <p className="text-sm leading-relaxed text-slate-300">{candidate.reasonDetailed}</p>
            </div>
          </Section>

          {/* 6. Haber katalizörleri */}
          <Section title="Haber Katalizörleri" icon={Newspaper}>
            <ul className="space-y-2">
              {candidate.relatedNews.map((news) => {
                const newsReliability = getReliabilityColor(news.reliability);
                const newsSentiment = getSentimentIcon(news.sentiment);
                const NewsIcon = newsSentiment.Icon;
                const hasLink = news.link && news.link !== '#';
                const TitleTag = hasLink ? 'a' : 'span';
                const titleProps = hasLink
                  ? { href: news.link, target: '_blank', rel: 'noopener noreferrer' }
                  : {};
                return (
                  <li key={news.title} className={boxClass}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${newsSentiment.bg} ${newsSentiment.text}`}>
                            <NewsIcon size={12} />
                          </span>
                          <TitleTag
                            {...titleProps}
                            className={hasLink ? 'transition-colors hover:text-accent-soft hover:underline' : ''}
                          >
                            {news.title}
                            {hasLink && <ExternalLink size={11} className="ml-1 inline align-baseline text-slate-500" />}
                          </TitleTag>
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-400">{news.summary}</p>
                        <p className="mt-1.5 text-[11px] text-slate-500">
                          {news.source} • {formatDate(news.date)} •{' '}
                          <span
                            className={
                              news.verificationStatus === 'Teyitli'
                                ? 'text-gain'
                                : news.verificationStatus === 'Teyitsiz'
                                  ? 'text-loss'
                                  : 'text-amber-400'
                            }
                          >
                            {news.verificationStatus}
                          </span>
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${newsReliability.badge}`}>
                        {news.reliability}/10
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>

          {/* 7. Teyit edilen kaynaklar */}
          <Section title="Teyit Edilen Kaynaklar" icon={CheckCircle2}>
            <ul className="flex flex-wrap gap-2">
              {candidate.verifiedSources.map((source) => (
                <li
                  key={source.sourceName}
                  className="flex items-center gap-1.5 rounded-lg border border-navy-700/60 bg-navy-850 px-2.5 py-1.5 text-xs text-slate-300"
                >
                  {source.isConfirmed ? (
                    <CheckCircle2 size={13} className="text-gain" />
                  ) : (
                    <XCircle size={13} className="text-loss" />
                  )}
                  <span>{source.sourceName}</span>
                  <span className="text-[10px] text-slate-500">({source.sourceType})</span>
                  <span className={`font-semibold ${getReliabilityColor(source.reliability).text}`}>
                    {source.reliability}/10
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          {/* 8 + 9. Teknik görünüm, hacim/temel metrikler ve likidite */}
          <Section
            title={horizon === 'long' ? 'Trend, Temel Metrikler ve Likidite' : 'Teknik Momentum, Hacim ve Likidite'}
            icon={BarChart3}
          >
            <div className={`${boxClass} grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4`}>
              {[
                [horizon === 'long' ? 'Trend' : 'Momentum', candidate.technicalMomentumLabel],
                ['Hacim Sinyali', candidate.volumeSignal],
                ['Likidite', candidate.liquidityLevel],
                ['Sektör Trendi', candidate.sectorTrend],
                ...(horizon === 'long'
                  ? [
                      ['Temettü Verimi', `%${candidate.dividendYield?.toFixed(1) ?? '—'}`],
                      ['F/K Oranı', candidate.peRatio ?? '—'],
                    ]
                  : []),
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="mt-0.5 text-sm font-medium text-slate-200">{value}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* 10. Volatilite ve risk uyarıları */}
          <Section title="Volatilite ve Risk Uyarıları" icon={AlertTriangle}>
            <div className={boxClass}>
              <p className="mb-2 text-xs text-slate-500">
                Volatilite: <span className="font-medium text-slate-300">{candidate.volatilitySignal}</span>
              </p>
              {candidate.riskWarnings.length === 0 ? (
                <p className="text-sm text-slate-400">Kayıtlı özel risk uyarısı bulunmuyor.</p>
              ) : (
                <ul className="space-y-1.5">
                  {candidate.riskWarnings.map((warning) => (
                    <li key={warning} className="flex items-start gap-2 text-sm text-slate-300">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />
                      {warning}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>

          {/* 11. Veri kalitesi / güven notu */}
          <Section title="Veri Kalitesi / Güven Notu" icon={ShieldCheck}>
            <div className={boxClass}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${reliabilityColors.badge}`}>
                  Ort. haber güvenilirliği: {candidate.averageNewsReliability.toFixed(1)}/10
                </span>
                <span className="rounded-md border border-navy-700 bg-navy-800 px-2 py-0.5 text-[11px] text-slate-300">
                  {confirmedCount}/{candidate.verifiedSources.length} kaynak teyitli
                </span>
                <span className="rounded-md border border-navy-700 bg-navy-800 px-2 py-0.5 text-[11px] text-slate-300">
                  {candidate.newsCount} haber tarandı
                </span>
                {candidate.newsConfidence != null && (
                  <span
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                      candidate.newsConfidence >= 60
                        ? 'border-gain/30 bg-gain/15 text-gain'
                        : candidate.newsConfidence >= 40
                          ? 'border-amber-400/30 bg-amber-400/15 text-amber-400'
                          : 'border-loss/30 bg-loss/15 text-loss'
                    }`}
                    title="Katalizör skorunun dayandığı haber kanıtının gücü (kaynak sayısı + güvenilirlik)"
                  >
                    Haber kanıt güveni: {candidate.newsConfidence}/100
                  </span>
                )}
              </div>
              <ul className="space-y-1.5 text-xs leading-relaxed text-slate-400">
                {candidate.isGated && (
                  <li className="flex items-start gap-2">
                    <Info size={13} className="mt-0.5 shrink-0 text-amber-400" />
                    Ortalama haber güvenilirliği eşik değerin ({RELIABILITY_GATE_THRESHOLD}/10)
                    altında kaldığı için haber katalizör puanı orantılı olarak kırpıldı.
                  </li>
                )}
                {candidate.isCapped && (
                  <li className="flex items-start gap-2">
                    <Info size={13} className="mt-0.5 shrink-0 text-amber-400" />
                    Yüksek risk seviyesi nedeniyle skor {HIGH_RISK_SCORE_CAP} ile sınırlandırıldı
                    (ham skor: {candidate.rawScore}).
                  </li>
                )}
                {candidate.isDecayed && (
                  <li className="flex items-start gap-2">
                    <Info size={13} className="mt-0.5 shrink-0 text-amber-400" />
                    Katalizör {candidate.daysSinceCatalyst} gün önce yayınlandı; tazelik çarpanı
                    ({Math.round(candidate.catalystFreshnessFactor * 100)}%) uygulanarak katalizör
                    puanı azaltıldı. Eski haberin kısa vadeli fiyat etkisi zamanla zayıflar.
                  </li>
                )}
                {candidate.isMomentumLimited && (
                  <li className="flex items-start gap-2">
                    <Info size={13} className="mt-0.5 shrink-0 text-amber-400" />
                    Hareket potansiyeli (momentum + hacim bileşkesi: {candidate.movePotential}/100)
                    eşik altında kaldığı için skor kırpıldı. Momentum ve hacim teyidi olmadan
                    hissenin beklenen vade içinde yükselişi gerçekleştirmesi zorlaşır.
                  </li>
                )}
                {candidate.isValueTrapRisk && (
                  <li className="flex items-start gap-2">
                    <Info size={13} className="mt-0.5 shrink-0 text-amber-400" />
                    Değerleme çok ucuz görünmesine rağmen büyüme görünümü zayıf (değer tuzağı
                    profili); skor temkinli olarak sınırlandırıldı.
                  </li>
                )}
                {candidate.newsConfidence != null && candidate.newsConfidence < 40 && (
                  <li className="flex items-start gap-2">
                    <Info size={13} className="mt-0.5 shrink-0 text-amber-400" />
                    Haber kanıtı zayıf (kanıt güveni {candidate.newsConfidence}/100): az sayıda veya
                    düşük güvenilirlikli kaynak bulunduğundan katalizör puanı nötr tabana çekildi;
                    tek bir başlığın skoru şişirmesi engellendi.
                  </li>
                )}
                {!candidate.isGated &&
                  !candidate.isCapped &&
                  !candidate.isDecayed &&
                  !candidate.isMomentumLimited &&
                  !candidate.isValueTrapRisk && (
                    <li className="flex items-start gap-2">
                      <Info size={13} className="mt-0.5 shrink-0 text-slate-500" />
                      Skora herhangi bir kırpma veya tavan uygulanmadı.
                    </li>
                  )}
                <li className="flex items-start gap-2">
                  <Info size={13} className="mt-0.5 shrink-0 text-slate-500" />
                  {isLive
                    ? 'Veriler gerçek piyasa, temel ve haber kaynaklarından otomatik üretildi. Skorlar veri kalitesine göre kırpılır; yine de yatırım tavsiyesi değildir.'
                    : 'Bu kayıt örnek (mock) veridir; canlı veri bağlandığında bu bölüm gerçek veri kalitesi raporunu gösterir.'}
                </li>
              </ul>
            </div>
          </Section>

          {/* 12. Uyarı */}
          <div className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
            <p className="text-xs leading-relaxed text-amber-200/80">
              Bu ekran yatırım tavsiyesi değildir. Sıralama ve skorlar yalnızca veri odaklı izleme
              ve araştırma amacıyla oluşturulmuştur.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

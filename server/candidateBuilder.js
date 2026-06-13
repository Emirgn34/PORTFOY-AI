/**
 * Fırsat adayı üretici (C aşaması).
 *
 * Her sembol için Yahoo Finance fiyat + temel verilerinden ve Supabase'deki
 * haberlerden GERÇEK scoreBreakdown + tüm görsel alanları türetir. Çıktı,
 * mock aday şemasıyla BİREBİR aynıdır; böylece skor motoru ve UI bileşenleri
 * hiç değişmeden çalışır. Her sembol için kısa ve uzun vade olmak üzere iki
 * aday üretilir (scoreBreakdown şemaları farklıdır).
 *
 * Tasarım notu: skor/etiket/sıra HER ZAMAN opportunityScoring.js tarafından
 * scoreBreakdown'dan türetilir; burada yalnızca breakdown + ham metrikler
 * üretilir (mock ile aynı sözleşme).
 */
import { mapExchangeToMarket, SECTOR_TR } from './marketData.js';

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(n);
const pctAbove = (a, b) => (a && b ? (a / b - 1) * 100 : 0);

/** Küratörlü ABD + BIST çekirdek evreni (takip edilen sembollerle birleştirilir). */
export const CANDIDATE_UNIVERSE = [
  // ABD (ağırlıklı)
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD', 'AVGO', 'NFLX',
  'JPM', 'V', 'MA', 'COST', 'WMT', 'XOM', 'LLY', 'UNH', 'KO', 'PEP',
  'DIS', 'CRM', 'ORCL', 'ADBE', 'INTC',
  // BIST
  'THYAO.IS', 'ASELS.IS', 'SISE.IS', 'TUPRS.IS', 'KCHOL.IS', 'SASA.IS', 'EREGL.IS',
  'BIMAS.IS', 'FROTO.IS', 'GARAN.IS', 'AKBNK.IS', 'PGSUS.IS', 'TCELL.IS', 'ENJSA.IS',
];

/** Yayıncı adından kaba güvenilirlik tahmini (AI yoksa kullanılır). */
function estimatePublisherReliability(publisher = '') {
  const p = publisher.toLowerCase();
  if (/reuters|bloomberg|associated press|wall street journal|financial times|kap|sec/.test(p)) return 9;
  if (/globenewswire|business wire|pr newswire/.test(p)) return 8;
  if (/yahoo|cnbc|barron|marketwatch|investing|ekonomim|dünya|bloomberght/.test(p)) return 7;
  if (/zacks|motley fool|simply wall|benzinga|insider monkey|paratic|mynet/.test(p)) return 6;
  return 5;
}

/** Yayıncıyı kaynak türüne sınıflar. */
function classifySource(publisher = '') {
  const p = publisher.toLowerCase();
  if (/kap|sec|globenewswire|business wire|pr newswire/.test(p)) return 'Resmi Bildirim';
  if (/reuters|bloomberg|associated press|anadolu/.test(p)) return 'Haber Ajansı';
  if (/zacks|motley fool|simply wall|benzinga|insider monkey/.test(p)) return 'Analiz / Araştırma';
  return 'Finans Medyası';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sembolün haberlerini aday alanlarına dönüştürür. */
function buildNewsAggregate(newsRows, referenceMs) {
  const rows = (newsRows ?? [])
    .map((r) => ({
      title: r.title_tr || r.title,
      summary: r.ai_summary_tr || `${r.publisher ?? 'Kaynak'} haberi.`,
      source: r.publisher ?? 'Bilinmeyen Kaynak',
      date: r.published_at,
      sentiment: ['positive', 'negative', 'neutral'].includes(r.sentiment) ? r.sentiment : 'neutral',
      reliability: Number.isFinite(r.reliability) ? r.reliability : estimatePublisherReliability(r.publisher),
    }))
    .sort((a, b) => new Date(b.date ?? 0) - new Date(a.date ?? 0));

  const newsCount = rows.length;
  const positiveNewsCount = rows.filter((r) => r.sentiment === 'positive').length;
  const negativeNewsCount = rows.filter((r) => r.sentiment === 'negative').length;
  const neutralNewsCount = newsCount - positiveNewsCount - negativeNewsCount;
  const averageNewsReliability =
    newsCount > 0 ? rows.reduce((s, r) => s + r.reliability, 0) / newsCount : 5;

  // En güçlü katalizör: en yeni pozitif haber, yoksa en yeni haber
  const catalyst = rows.find((r) => r.sentiment === 'positive') ?? rows[0] ?? null;
  const daysSince = catalyst?.date ? Math.max(0, (referenceMs - new Date(catalyst.date)) / DAY_MS) : null;

  // Haber katalizör skoru: ton + güvenilirlik + tazelik
  let newsCatalystScore = 35;
  if (catalyst) {
    const sentBase = catalyst.sentiment === 'positive' ? 80 : catalyst.sentiment === 'negative' ? 28 : 52;
    const relAdj = (averageNewsReliability - 5) * 3;
    const freshAdj = daysSince == null ? 0 : daysSince <= 2 ? 8 : daysSince <= 7 ? 0 : -10;
    newsCatalystScore = clamp(sentBase + relAdj + freshAdj);
  }

  const relatedNews = rows.slice(0, 4).map((r) => ({
    title: r.title,
    summary: r.summary,
    source: r.source,
    date: r.date,
    sentiment: r.sentiment,
    reliability: r.reliability,
    verificationStatus: r.reliability >= 8 ? 'Teyitli' : r.reliability >= 5 ? 'Kısmen Teyitli' : 'Teyitsiz',
  }));

  const seen = new Set();
  const verifiedSources = [];
  for (const r of relatedNews) {
    if (seen.has(r.source)) continue;
    seen.add(r.source);
    verifiedSources.push({
      sourceName: r.source,
      sourceType: classifySource(r.source),
      reliability: r.reliability,
      url: '#',
      isConfirmed: r.reliability >= 7,
    });
  }

  return {
    newsCount,
    positiveNewsCount,
    negativeNewsCount,
    neutralNewsCount,
    averageNewsReliability: Number(averageNewsReliability.toFixed(1)),
    newsCatalystScore: round(newsCatalystScore),
    newsReliabilityScore: round(clamp(averageNewsReliability * 10)),
    catalyst,
    catalystDate: catalyst?.date ?? null,
    sentiment: catalyst?.sentiment ?? 'neutral',
    relatedNews,
    verifiedSources: verifiedSources.length
      ? verifiedSources
      : [{ sourceName: 'Veri tabanı', sourceType: 'Otomatik Tarama', reliability: 5, url: '#', isConfirmed: false }],
  };
}

/** quote + quoteSummary'den teknik/risk/likidite/temel metrikleri türetir. */
function buildMarketMetrics(quote, summary) {
  const price = quote.regularMarketPrice ?? null;
  const ma50 = quote.fiftyDayAverage ?? null;
  const ma200 = quote.twoHundredDayAverage ?? null;
  const chg = quote.regularMarketChangePercent ?? 0;
  const high52 = quote.fiftyTwoWeekHigh ?? null;
  const low52 = quote.fiftyTwoWeekLow ?? null;
  const vol = quote.regularMarketVolume ?? null;
  const avgVol = quote.averageDailyVolume3Month ?? quote.averageDailyVolume10Day ?? null;
  const marketCap = quote.marketCap ?? null;

  const detail = summary?.summaryDetail ?? {};
  const fin = summary?.financialData ?? {};
  const stats = summary?.defaultKeyStatistics ?? {};
  const beta = detail.beta ?? stats.beta ?? 1;

  // --- Teknik momentum ---
  const technicalMomentumScore = round(
    clamp(50 + pctAbove(price, ma50) * 2 + pctAbove(price, ma200) * 1 + chg * 1.5)
  );

  // --- Hacim teyidi ---
  const volRatio = vol && avgVol ? vol / avgVol : 1;
  const volumeConfirmationScore = round(clamp(55 + (volRatio - 1) * 60));
  const volumeSignal =
    volRatio >= 1.5 ? 'Güçlü Hacim Artışı'
      : volRatio >= 1.1 ? 'Hacim Artışı'
      : volRatio >= 0.7 ? 'Normal Hacim'
      : 'Zayıf Hacim';

  // --- Likidite (piyasa değeri log ölçeği) ---
  const liquidityScore = marketCap
    ? round(clamp((Math.log10(marketCap) - 8.5) * 22))
    : 45;
  const liquidityLevel = liquidityScore >= 70 ? 'Yüksek' : liquidityScore >= 40 ? 'Orta' : 'Düşük';

  // --- Risk / volatilite ---
  const rangePct = price && high52 && low52 ? ((high52 - low52) / price) * 100 : 50;
  const volScore = clamp((beta - 0.5) * 40 + (rangePct - 30) * 0.8);
  const volatilitySignal = volScore >= 66 ? 'Yüksek Volatilite' : volScore >= 40 ? 'Orta Volatilite' : 'Düşük Volatilite';
  const riskIndex = volScore * 0.6 + (100 - liquidityScore) * 0.4;
  const riskLevel = riskIndex >= 60 ? 'Yüksek' : riskIndex >= 38 ? 'Orta' : 'Düşük';
  const riskAdjustedScore = round(clamp(100 - riskIndex));

  // --- Sektör/piyasa uyumu (trend bazlı) ---
  const aboveMa200 = price && ma200 ? price > ma200 : false;
  const goldenCross = ma50 && ma200 ? ma50 > ma200 : false;
  const sectorMarketFitScore = round(clamp(58 + (aboveMa200 ? 12 : -12) + (goldenCross ? 6 : -6), 30, 88));

  // --- Temel analiz (uzun vade) ---
  const pm = fin.profitMargins ?? null;
  const roe = fin.returnOnEquity ?? null;
  const d2e = fin.debtToEquity ?? null;
  const cr = fin.currentRatio ?? null;
  const fundamentalHealthScore = round(
    clamp(
      50 +
        (pm != null ? pm * 100 * 1.2 : 0) +
        (roe != null ? roe * 100 * 0.8 : 0) -
        (d2e != null ? (d2e / 100) * 15 : 0) +
        (cr != null ? (cr - 1) * 10 : 0)
    )
  );

  // Değerleme: ucuz = yüksek. F/K birincil; PD/DD yalnızca makul aralıkta
  // (geri alım/sektör kaynaklı aşırı PD/DD değerleri skoru çarpıtmasın).
  const pe = detail.trailingPE ?? detail.forwardPE ?? fin.forwardPE ?? null;
  const pb = stats.priceToBook ?? null;
  const peScore = pe && pe > 0 ? clamp(125 - pe * 2.2) : null;
  const pbScore = pb && pb > 0 && pb < 20 ? clamp(110 - pb * 7) : null;
  let valuationScore;
  if (peScore != null && pbScore != null) valuationScore = round(peScore * 0.65 + pbScore * 0.35);
  else if (peScore != null) valuationScore = round(peScore);
  else if (pbScore != null) valuationScore = round(pbScore);
  else valuationScore = 50;

  const eg = fin.earningsGrowth ?? null;
  const rg = fin.revenueGrowth ?? null;
  const growthScore = round(
    clamp(50 + (eg != null ? eg * 100 * 1.2 : 0) + (rg != null ? rg * 100 * 0.8 : 0))
  );

  const dy = detail.dividendYield ?? null;
  const payout = detail.payoutRatio ?? null;
  const fcf = fin.freeCashflow ?? null;
  const dividendScore = round(
    clamp(40 + (dy != null ? dy * 100 * 8 : 0) + (fcf && fcf > 0 ? 15 : 0) - (payout && payout > 0.8 ? 15 : 0))
  );

  return {
    price, chg, ma50, ma200,
    technicalMomentumScore, volumeConfirmationScore, volumeSignal,
    liquidityScore, liquidityLevel, volatilitySignal, riskLevel, riskAdjustedScore,
    sectorMarketFitScore, aboveMa200, goldenCross,
    fundamentalHealthScore, valuationScore, growthScore, dividendScore,
    peRatio: pe ? Number(pe.toFixed(1)) : null,
    dividendYield: dy != null ? Number((dy * 100).toFixed(1)) : null,
  };
}

function momentumLabel(score, horizon) {
  if (horizon === 'long') {
    if (score >= 70) return 'Uzun Vadeli Yükselen Trend';
    if (score >= 50) return 'Yatay / Toparlanma';
    return 'Uzun Vadeli Zayıf Trend';
  }
  if (score >= 75) return 'Güçlü Yükseliş';
  if (score >= 55) return 'Yükseliş';
  if (score >= 45) return 'Yatay';
  return 'Düşüş';
}

/** Bir sembol için kısa + uzun vade aday nesnelerini üretir. */
function buildCandidatePair(symbol, quote, summary, newsRows, referenceMs) {
  const news = buildNewsAggregate(newsRows, referenceMs);
  const m = buildMarketMetrics(quote, summary);

  const market = mapExchangeToMarket(symbol, quote.fullExchangeName ?? quote.exchange ?? '');
  const ticker = symbol.replace(/\.IS$/, '');
  const companyName = quote.longName ?? quote.shortName ?? ticker;
  const rawSector = summary?.assetProfile?.sector ?? null;
  const sector = SECTOR_TR[rawSector] ?? rawSector ?? 'Diğer';
  const currency = quote.currency ?? (symbol.endsWith('.IS') ? 'TRY' : 'USD');

  const base = {
    symbol: ticker,
    companyName,
    market,
    sector,
    currency,
    currentPrice: m.price,
    dailyChangePercent: m.chg != null ? Number(m.chg.toFixed(2)) : 0,
    riskLevel: m.riskLevel,
    liquidityLevel: m.liquidityLevel,
    strongestCatalystTitle: news.catalyst?.title ?? `${ticker} için güncel öne çıkan gelişme bulunamadı`,
    strongestCatalystSummary:
      news.catalyst?.summary ??
      'Bu sembol için yakın tarihli belirgin bir haber katalizörü tespit edilmedi; skor teknik ve temel verilere dayanıyor.',
    catalystDate: news.catalystDate ?? new Date(referenceMs).toISOString(),
    sentiment: news.sentiment,
    newsCount: news.newsCount,
    positiveNewsCount: news.positiveNewsCount,
    negativeNewsCount: news.negativeNewsCount,
    neutralNewsCount: news.neutralNewsCount,
    averageNewsReliability: news.averageNewsReliability,
    volumeSignal: m.volumeSignal,
    volatilitySignal: m.volatilitySignal,
    previousRank: null,
    relatedNews: news.relatedNews,
    verifiedSources: news.verifiedSources,
  };

  // --- Kısa vade ---
  const shortMomentum = momentumLabel(m.technicalMomentumScore, 'short');
  const shortWarnings = [];
  if (m.riskLevel === 'Yüksek') shortWarnings.push('Risk seviyesi yüksek; gün içi sert hareketler görülebilir.');
  if (m.liquidityLevel === 'Düşük') shortWarnings.push('Düşük likidite alım-satım farklarını artırabilir.');
  if (news.averageNewsReliability < 4) shortWarnings.push('Ortalama haber güvenilirliği düşük; katalizör puanı kırpılır.');
  if (m.volumeSignal === 'Zayıf Hacim') shortWarnings.push('Hacim teyidi zayıf; hareket potansiyeli sınırlı olabilir.');

  const shortCandidate = {
    ...base,
    id: `live-st-${ticker}`,
    technicalMomentumLabel: shortMomentum,
    sectorTrend: m.aboveMa200 ? 'Fiyat 200 günlük ortalamanın üzerinde' : 'Fiyat 200 günlük ortalamanın altında',
    estimatedHorizon: m.technicalMomentumScore >= 70 ? '1-3 hafta' : '2-6 hafta',
    reasonShort:
      `Teknik momentum ${shortMomentum.toLowerCase()}, ${m.volumeSignal.toLowerCase()}; ` +
      `ortalama haber güvenilirliği ${news.averageNewsReliability}/10.`,
    reasonDetailed:
      `Bu aday gerçek piyasa verisinden türetildi. Teknik momentum skoru ${m.technicalMomentumScore}/100 ` +
      `(${shortMomentum}); hacim teyidi ${m.volumeConfirmationScore}/100 (${m.volumeSignal}). ` +
      `${news.newsCount} haber tarandı, ortalama güvenilirlik ${news.averageNewsReliability}/10, ` +
      `haber katalizör skoru ${news.newsCatalystScore}/100. Likidite ${m.liquidityLevel.toLowerCase()} ` +
      `(${m.liquidityScore}/100), risk seviyesi ${m.riskLevel}. ` +
      `Skor ve sıra bu bileşenlerin vadeye uygun ağırlıklı toplamından hesaplanır.`,
    scoreBreakdown: {
      newsCatalystScore: news.newsCatalystScore,
      newsReliabilityScore: news.newsReliabilityScore,
      technicalMomentumScore: m.technicalMomentumScore,
      volumeConfirmationScore: m.volumeConfirmationScore,
      riskAdjustedScore: m.riskAdjustedScore,
      liquidityScore: m.liquidityScore,
      sectorMarketFitScore: m.sectorMarketFitScore,
    },
    riskWarnings: shortWarnings,
  };

  // --- Uzun vade ---
  const longMomentum = momentumLabel(m.technicalMomentumScore, 'long');
  const longWarnings = [];
  if (m.valuationScore < 40) longWarnings.push('Değerleme çarpanları yüksek; geri çekilmelerde girişe dikkat.');
  if (m.growthScore < 40) longWarnings.push('Büyüme görünümü zayıf; temel iyileşme teyidi beklenebilir.');
  if (m.fundamentalHealthScore < 45) longWarnings.push('Bilanço göstergeleri zayıf; borç/marj takibi önemli.');
  if (m.riskLevel === 'Yüksek') longWarnings.push('Volatilite yüksek; uzun vadeli kademeli alım daha uygun olabilir.');

  const longCandidate = {
    ...base,
    id: `live-lt-${ticker}`,
    dividendYield: m.dividendYield,
    peRatio: m.peRatio,
    technicalMomentumLabel: longMomentum,
    sectorTrend: m.goldenCross ? 'Uzun vadeli trend pozitif (50>200 GO)' : 'Uzun vadeli trend zayıf',
    estimatedHorizon: m.valuationScore >= 60 ? '1-3 yıl' : '6-12 ay',
    reasonShort:
      `Temel sağlamlık ${m.fundamentalHealthScore}/100, değerleme ${m.valuationScore}/100, ` +
      `büyüme ${m.growthScore}/100.`,
    reasonDetailed:
      `Uzun vade adayı temel verilerden türetildi. Temel sağlamlık ${m.fundamentalHealthScore}/100 ` +
      `(marj, özsermaye kârlılığı, borç ve likidite oranları); değerleme ${m.valuationScore}/100 ` +
      `(F/K ${m.peRatio ?? '—'} ve PD/DD esaslı, ucuz = yüksek); büyüme görünümü ${m.growthScore}/100; ` +
      `temettü/nakit akışı ${m.dividendScore}/100 (verim %${m.dividendYield ?? '—'}). ` +
      `Likidite ${m.liquidityLevel.toLowerCase()}, risk ${m.riskLevel}. Skor uzun vade ağırlıklarıyla hesaplanır.`,
    scoreBreakdown: {
      fundamentalHealthScore: m.fundamentalHealthScore,
      valuationScore: m.valuationScore,
      growthScore: m.growthScore,
      dividendScore: m.dividendScore,
      newsReliabilityScore: news.newsReliabilityScore,
      sectorMarketFitScore: m.sectorMarketFitScore,
      liquidityScore: m.liquidityScore,
    },
    riskWarnings: longWarnings,
  };

  return { shortCandidate, longCandidate, market };
}

/**
 * Verilen semboller için aday satırlarını üretir.
 * deps: { yahooFinance, getNewsForSymbol(symbol) -> Promise<rows> }
 * Dönüş: [{ symbol, horizon, market, data }] (Supabase'e upsert için).
 */
export async function buildCandidates(symbols, { yahooFinance, getNewsForSymbol }) {
  const referenceMs = Date.now();
  const rows = [];

  // Fiyatlar tek toplu çağrıda
  let quoteMap = new Map();
  try {
    const quotes = await yahooFinance.quote(symbols);
    for (const q of Array.isArray(quotes) ? quotes : [quotes]) quoteMap.set(q.symbol, q);
  } catch (err) {
    console.error(`[candidates] toplu fiyat hatası: ${err.message}`);
  }

  for (const symbol of symbols) {
    const quote = quoteMap.get(symbol);
    if (!quote || quote.regularMarketPrice == null) continue;

    let summary = null;
    try {
      summary = await yahooFinance.quoteSummary(symbol, {
        modules: ['assetProfile', 'summaryDetail', 'financialData', 'defaultKeyStatistics'],
      });
    } catch {
      summary = null; // temel veri yoksa kısa vade yine çalışır
    }

    let newsRows = [];
    try {
      newsRows = (await getNewsForSymbol(symbol)) ?? [];
    } catch {
      newsRows = [];
    }

    try {
      const { shortCandidate, longCandidate, market } = buildCandidatePair(
        symbol, quote, summary, newsRows, referenceMs
      );
      rows.push({ symbol, horizon: 'short', market, data: shortCandidate });
      rows.push({ symbol, horizon: 'long', market, data: longCandidate });
    } catch (err) {
      console.error(`[candidates] ${symbol}: ${err.message}`);
    }
  }

  return rows;
}

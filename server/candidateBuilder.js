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
import { fetchDailyHistory, analyzeTechnicals } from './technicalAnalysis.js';
import { mapLimit } from './concurrency.js';

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const round = (n) => Math.round(n);
const pctAbove = (a, b) => (a && b ? (a / b - 1) * 100 : 0);

/**
 * Seans içinde geçen sürenin oranı (0–1). Hacim teyidini bununla normalize
 * ederiz: anlık günlük hacmi 3 aylık ortalamanın TAMAMIYLA değil, seansın
 * geçen kısmıyla kıyaslarız. Aksi halde sabah saatlerinde her hisse haksız
 * yere "Zayıf Hacim" görünür. Piyasa kapalı/öncesi/sonrası ise hacim zaten
 * tam seansa aittir → 1 döner. Veri eksikse güvenli tarafta 1 döner.
 */
function sessionElapsedFraction(quote) {
  if (quote?.marketState && quote.marketState !== 'REGULAR') return 1;
  const t = quote?.regularMarketTime;
  const off = quote?.gmtOffSetMilliseconds;
  if (t == null || off == null) return 1;
  const ms = (t instanceof Date ? t.getTime() : new Date(t).getTime()) + off;
  if (Number.isNaN(ms)) return 1;
  const local = new Date(ms);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const isBist = (quote.symbol ?? '').endsWith('.IS');
  const open = isBist ? 600 : 570; // BIST 10:00, ABD 09:30 (yerel)
  const close = isBist ? 1080 : 960; // BIST 18:00, ABD 16:00 (yerel)
  if (minutes >= close) return 1;
  // Açılış öncesi/anında bile sıfıra bölmeyi önlemek için küçük bir taban.
  return clamp((minutes - open) / (close - open), 0.05, 1);
}

/**
 * Kısa vade için tahmini izleme penceresi. Analog analiz geleceğe dönük
 * ~20 işlem günü (≈4 hafta) ölçtüğünden taban budur; yıllık volatilite
 * pencereyi daraltır/genişletir (yüksek volatilite → hareket daha hızlı
 * gelişir). Teknik veri yoksa nötr bir aralık döner.
 */
function estimateShortHorizon(annVol) {
  if (annVol == null) return '2-6 hafta';
  if (annVol >= 45) return '1-3 hafta';
  if (annVol >= 28) return '2-4 hafta';
  return '3-6 hafta';
}

/**
 * Uzun vade için tahmini tez süresi. Büyüme yüksekse yeniden fiyatlama daha
 * erken gelir; düşük büyüme + ucuz değerleme (klasik değer hissesi) daha uzun
 * sabır gerektirir.
 */
function estimateLongHorizon(growthScore) {
  if (growthScore >= 65) return '6-12 ay';
  if (growthScore >= 45) return '1-2 yıl';
  return '2-4 yıl';
}

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

/**
 * Yahoo Finance hazır taramalarından dinamik ABD evreni getirir
 * (günlük yükselenler + en aktifler). Böylece "fırsatlar" sabit 40 hisseyle
 * sınırlı kalmaz; o gün gerçekten hareketlenen hisseler de aday havuzuna girer.
 * BIST için Yahoo hazır taraması olmadığından küratörlü BIST listesi korunur.
 * Hata/erişim sorununda boş döner (akış küratörlü evrenle sürer).
 */
export async function fetchDynamicUniverse(yahooFinance, { perList = 25 } = {}) {
  const scrIds = ['day_gainers', 'most_actives'];
  const symbols = new Set();
  for (const scrId of scrIds) {
    try {
      const res = await yahooFinance.screener({ scrIds: scrId, count: perList });
      for (const q of res?.quotes ?? []) {
        const s = q?.symbol;
        // Yalnızca düz ABD hisseleri: harf/nokta (ETF/fon/türev dışı), gerçek equity
        if (s && q.quoteType === 'EQUITY' && /^[A-Z][A-Z.]*$/.test(s)) symbols.add(s);
      }
    } catch (err) {
      console.error(`[screener] ${scrId}: ${err.message}`);
    }
  }
  return [...symbols];
}

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
      link: r.link ?? null,
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

  // --- Katalizör seçimi + skoru (gürültüye dayanıklı) ---
  // Her habere tazelik ve güvenilirlik ağırlığı verilir; böylece tek bir taze ama
  // zayıf/teyitsiz başlık, skoru tek başına yukarı çekemez.
  const RECENT_WINDOW_DAYS = 21; // katalizör/konsensüs penceresi
  const weighted = rows.map((r) => {
    const ageDays = r.date ? Math.max(0, (referenceMs - new Date(r.date)) / DAY_MS) : 999;
    const freshW = Math.pow(0.5, Math.max(0, ageDays - 2) / 7); // 2g tam etki, 7g yarı ömür
    const relW = clamp01((r.reliability - 3) / 6); // güvenilirlik ≤3 → ~0, ≥9 → 1
    const sent = r.sentiment === 'positive' ? 1 : r.sentiment === 'negative' ? -1 : 0;
    return { ...r, ageDays, freshW, relW, sent };
  });

  // En güçlü katalizör: pencere içinde tazelik×güvenilirlik×ton-önceliği en yüksek olan
  // (yalnızca "en yeni pozitif" değil). Pencerede yoksa en yeni habere düşülür.
  const TONE_PRIORITY = { positive: 1, negative: 0.7, neutral: 0.5 };
  const inWindow = weighted.filter((a) => a.ageDays <= RECENT_WINDOW_DAYS);
  const catalystRank = (a) => a.freshW * a.relW * (TONE_PRIORITY[a.sentiment] ?? 0.5);
  const catalyst =
    [...inWindow].sort((a, b) => catalystRank(b) - catalystRank(a))[0] ?? rows[0] ?? null;
  const daysSince = catalyst?.date ? Math.max(0, (referenceMs - new Date(catalyst.date)) / DAY_MS) : null;

  // Konsensüs: güvenilirlik+tazelik ağırlıklı net ton (−1..+1). Tek başlık baskısını seyreltir.
  const wTotal = weighted.reduce((s, a) => s + a.freshW * a.relW, 0);
  const netSentiment =
    wTotal > 0 ? weighted.reduce((s, a) => s + a.sent * a.freshW * a.relW, 0) / wTotal : 0;

  // Kanıt güveni: yeterince yeni + güvenilir haber var mı? Yoksa skor nötre çekilir.
  const reliableRecent = inWindow.filter((a) => a.relW >= 0.4).length;
  const countConf = clamp01(reliableRecent / 3); // ~3 güvenilir yeni haber → tam güven
  const relConf = clamp01((averageNewsReliability - 3) / 4); // ort. güvenilirlik 3→0, 7→1
  const newsConfidence01 = newsCount === 0 ? 0 : clamp01(0.6 * countConf + 0.4 * relConf);

  // Ham katalizör (ton+güvenilirlik+tazelik) ile konsensüsü harmanla; sonra kanıt güvenine
  // göre nötr tabana çek. Zayıf kanıtlı sinyaller %25'lik ağırlıkta domine edemez.
  const NEUTRAL_BASE = 45; // katalizör yoksa kısa vade için hafif olumsuz taban
  let newsCatalystScore = NEUTRAL_BASE;
  if (catalyst && newsCount > 0) {
    const sentBase = catalyst.sentiment === 'positive' ? 80 : catalyst.sentiment === 'negative' ? 28 : 52;
    const relAdj = (averageNewsReliability - 5) * 3;
    const freshAdj = daysSince == null ? 0 : daysSince <= 2 ? 8 : daysSince <= 7 ? 0 : -10;
    const rawCatalyst = clamp(sentBase + relAdj + freshAdj);
    const consensusScore = 50 + netSentiment * 30; // −1 → 20, +1 → 80
    const blended = 0.6 * rawCatalyst + 0.4 * consensusScore;
    newsCatalystScore = NEUTRAL_BASE + (blended - NEUTRAL_BASE) * newsConfidence01;
  }
  newsCatalystScore = clamp(newsCatalystScore);
  const newsConfidence = round(newsConfidence01 * 100);

  const relatedNews = rows.slice(0, 5).map((r) => ({
    title: r.title,
    summary: r.summary,
    source: r.source,
    date: r.date,
    link: r.link,
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
    newsConfidence,
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

/** quote + quoteSummary + (varsa) geçmiş grafik analizinden metrikleri türetir. */
function buildMarketMetrics(quote, summary, tech) {
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

  // --- Teknik momentum: varsa gerçek göstergeler (RSI, MACD, momentum, analog edge) ---
  let technicalMomentumScore;
  if (tech) {
    let t = 50;
    t += clamp((tech.pctVsSma50 ?? 0) * 1.4, -15, 15);
    t += clamp((tech.pctVsSma200 ?? 0) * 0.7, -10, 10);
    t += tech.macdPositive ? 7 : -7;
    t += clamp(((tech.rsi ?? 50) - 50) * 0.4, -8, 10);
    if ((tech.rsi ?? 50) > 80) t -= 8; // aşırı alım bölgesi
    t += clamp((tech.ret20 ?? 0) * 0.5, -10, 12);
    // Geçmiş benzer grafik kurulumunun 20 günlük ortalama getirisi (analog edge).
    // Katkı, analogun güvenine göre ölçeklenir: tutarsız/zayıf örnekler momentumu az etkiler.
    if (tech.analogShort) {
      t += clamp(tech.analogShort.avg * 0.8 * (tech.analogShort.confidence ?? 1), -10, 12);
    }
    technicalMomentumScore = round(clamp(t));
  } else {
    technicalMomentumScore = round(
      clamp(50 + pctAbove(price, ma50) * 2 + pctAbove(price, ma200) * 1 + chg * 1.5)
    );
  }

  // --- Hacim teyidi (seans-içi normalize) ---
  // Anlık hacmi 3 aylık ortalamanın tamamıyla değil, seansın geçen kısmıyla
  // kıyaslarız; böylece açılış saatlerinde haksız "Zayıf Hacim" sinyali oluşmaz.
  const elapsed = sessionElapsedFraction(quote);
  const expectedVolSoFar = avgVol != null ? avgVol * elapsed : null;
  const volRatio = vol && expectedVolSoFar ? vol / expectedVolSoFar : 1;
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

  // --- Risk / volatilite: varsa gerçek yıllık volatilite, yoksa beta+52h aralığı ---
  let volScore;
  if (tech?.annVol != null) {
    volScore = clamp((tech.annVol - 15) * 2.2); // %15→0, %30→33, %45→66, %60→100
  } else {
    const rangePct = price && high52 && low52 ? ((high52 - low52) / price) * 100 : 50;
    volScore = clamp((beta - 0.5) * 40 + (rangePct - 30) * 0.8);
  }
  const volatilitySignal = volScore >= 66 ? 'Yüksek Volatilite' : volScore >= 40 ? 'Orta Volatilite' : 'Düşük Volatilite';
  const riskIndex = volScore * 0.6 + (100 - liquidityScore) * 0.4;
  const riskLevel = riskIndex >= 60 ? 'Yüksek' : riskIndex >= 38 ? 'Orta' : 'Düşük';
  const riskAdjustedScore = round(clamp(100 - riskIndex));

  // --- Sektör/piyasa uyumu (trend bazlı; varsa gerçek SMA ilişkilerinden) ---
  const aboveMa200 = tech?.pctVsSma200 != null ? tech.pctVsSma200 > 0 : price && ma200 ? price > ma200 : false;
  const goldenCross = tech?.goldenCross != null ? tech.goldenCross : ma50 && ma200 ? ma50 > ma200 : false;
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
    // Teknik göstergeler (varsa) — gerekçe metninde kullanılır
    hasTech: Boolean(tech),
    rsi: tech?.rsi ?? null,
    macdPositive: tech?.macdPositive ?? null,
    ret20: tech?.ret20 ?? null,
    ret60: tech?.ret60 ?? null,
    annVol: tech?.annVol ?? null,
    pctFrom52High: tech?.pctFrom52High ?? null,
    analogShort: tech?.analogShort ?? null,
    analogLong: tech?.analogLong ?? null,
  };
}

/** Güven skorunu (0..1) sözel etikete çevirir. */
function confidenceLabel(c) {
  if (c == null) return null;
  if (c >= 0.6) return 'yüksek';
  if (c >= 0.35) return 'orta';
  return 'düşük';
}

/** Analog sonucunu okunaklı ve dürüst bir cümleye çevirir (dağılım + güven dahil). */
function analogSentence(analog) {
  if (!analog) return '';
  const yon = analog.avg > 0 ? 'yükseliş' : analog.avg < 0 ? 'düşüş' : 'yatay seyir';
  const dispNote = analog.std != null ? `, ±%${analog.std} dağılım` : '';
  const conf = confidenceLabel(analog.confidence);
  const confNote = conf
    ? ` Sinyal güveni: ${conf}${conf === 'düşük' ? ' — örnekler tutarsız, tek başına yön belirleyici sayılmamalı' : ''}.`
    : '';
  return (
    `Geçmişte grafik bugünküne benzer göründüğü ${analog.count} örnekte, sonraki ` +
    `${analog.fwdDays} günde fiyat ortalama %${analog.avg} (${yon}, kazanç oranı %${analog.win}, ` +
    `medyan %${analog.median}${dispNote}) hareket etmiş.${confNote}`
  );
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
function buildCandidatePair(symbol, quote, summary, newsRows, referenceMs, tech) {
  const news = buildNewsAggregate(newsRows, referenceMs);
  const m = buildMarketMetrics(quote, summary, tech);

  const techNote = m.hasTech
    ? `Teknik göstergeler: RSI ${m.rsi}, MACD ${m.macdPositive ? 'pozitif' : 'negatif'}, ` +
      `son 20 günde %${m.ret20 ?? '—'}, yıllık volatilite %${m.annVol}. `
    : '';
  const analogShortNote = analogSentence(m.analogShort);
  const analogLongNote = analogSentence(m.analogLong);

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
    // 'deep' = 2 yıllık geçmiş grafikten gerçek teknik/analog; 'light' = yalnızca
    // quote alanlarından fiyat-temelli proxy. Vitrindeki ilk 30 her zaman 'deep' olmalı.
    analysisDepth: m.hasTech ? 'deep' : 'light',
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
    newsConfidence: news.newsConfidence,
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
  if (news.newsConfidence < 40) shortWarnings.push('Haber kanıtı zayıf (az sayıda veya düşük güvenilirlikli kaynak); katalizör sinyali nötre çekildi.');
  if (m.volumeSignal === 'Zayıf Hacim') shortWarnings.push('Hacim teyidi zayıf; hareket potansiyeli sınırlı olabilir.');
  if (m.analogShort?.confidence != null && m.analogShort.confidence < 0.35)
    shortWarnings.push('Geçmiş-benzerlik (analog) sinyalinin güveni düşük; örnekler tutarsız, tek başına yön belirleyici sayılmamalı.');

  const shortCandidate = {
    ...base,
    id: `live-st-${ticker}`,
    technicalMomentumLabel: shortMomentum,
    sectorTrend: m.aboveMa200 ? 'Fiyat 200 günlük ortalamanın üzerinde' : 'Fiyat 200 günlük ortalamanın altında',
    estimatedHorizon: estimateShortHorizon(m.annVol),
    reasonShort:
      `Teknik momentum ${shortMomentum.toLowerCase()}, ${m.volumeSignal.toLowerCase()}; ` +
      `ortalama haber güvenilirliği ${news.averageNewsReliability}/10.` +
      (m.analogShort ? ` Geçmiş benzer kurulum 20g: %${m.analogShort.avg} (kazanç %${m.analogShort.win}).` : ''),
    reasonDetailed:
      `Bu aday gerçek piyasa verisinden türetildi. Teknik momentum skoru ${m.technicalMomentumScore}/100 ` +
      `(${shortMomentum}); hacim teyidi ${m.volumeConfirmationScore}/100 (${m.volumeSignal}). ` +
      `${news.newsCount} haber tarandı, ortalama güvenilirlik ${news.averageNewsReliability}/10, ` +
      `haber katalizör skoru ${news.newsCatalystScore}/100. Likidite ${m.liquidityLevel.toLowerCase()} ` +
      `(${m.liquidityScore}/100), risk seviyesi ${m.riskLevel}. ${techNote}${analogShortNote} ` +
      `Tahmini vade, analogun ölçtüğü ~20 işlem günü (≈4 hafta) penceresinin ` +
      `yıllık volatiliteye (%${m.annVol ?? '—'}) göre ölçeklenmesiyle belirlenir. ` +
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
    estimatedHorizon: estimateLongHorizon(m.growthScore),
    reasonShort:
      `Temel sağlamlık ${m.fundamentalHealthScore}/100, değerleme ${m.valuationScore}/100, ` +
      `büyüme ${m.growthScore}/100.`,
    reasonDetailed:
      `Uzun vade adayı temel verilerden türetildi. Temel sağlamlık ${m.fundamentalHealthScore}/100 ` +
      `(marj, özsermaye kârlılığı, borç ve likidite oranları); değerleme ${m.valuationScore}/100 ` +
      `(F/K ${m.peRatio ?? '—'} ve PD/DD esaslı, ucuz = yüksek); büyüme görünümü ${m.growthScore}/100; ` +
      `temettü/nakit akışı ${m.dividendScore}/100 (verim %${m.dividendYield ?? '—'}). ` +
      `Likidite ${m.liquidityLevel.toLowerCase()}, risk ${m.riskLevel}. ${analogLongNote} Skor uzun vade ağırlıklarıyla hesaplanır.`,
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

/** 2 yıllık geçmişi retry'lı çeker (deep modda "şart koşulan" veri için). */
async function fetchHistoryWithRetry(yahooFinance, symbol, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const history = await fetchDailyHistory(yahooFinance, symbol);
      const tech = analyzeTechnicals(history);
      if (tech) return tech;
    } catch {
      // sonraki denemeye
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1))); // backoff
  }
  return null;
}

/**
 * Verilen semboller için aday satırlarını üretir.
 * deps: {
 *   yahooFinance,
 *   getNewsForSymbol(symbol) -> Promise<rows>,
 *   deep   : true → 2 yıllık geçmiş grafik (retry'lı) çekilir; false → yalnızca
 *            quote alanlarından fiyat-temelli proxy (hızlı, Faz 2 ön-sıralama için),
 *   quoteMap : Faz 1'de zaten çekilmiş quote'lar (varsa tekrar çekilmez),
 * }
 * Dönüş: [{ symbol, horizon, market, data }] (Supabase'e upsert için).
 */
export async function buildCandidates(
  symbols,
  { yahooFinance, getNewsForSymbol, deep = true, quoteMap = null, concurrency = deep ? 4 : 6 }
) {
  const referenceMs = Date.now();

  // Quote'lar: Faz 1'den geldiyse onu kullan; eksikleri toplu çek
  const quotes = quoteMap instanceof Map ? new Map(quoteMap) : new Map();
  const missing = symbols.filter((s) => !quotes.has(s));
  if (missing.length > 0) {
    try {
      const fetched = await yahooFinance.quote(missing);
      for (const q of Array.isArray(fetched) ? fetched : [fetched]) quotes.set(q.symbol, q);
    } catch (err) {
      console.error(`[candidates] toplu fiyat hatası: ${err.message}`);
    }
  }

  // Her sembol bağımsız → sınırlı eşzamanlılıkla paralel (deep: 4, light: 6).
  const nested = await mapLimit(symbols, concurrency, async (symbol) => {
    const quote = quotes.get(symbol);
    if (!quote || quote.regularMarketPrice == null) return [];

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

    // Deep: 2 yıllık geçmiş grafik (RSI/MACD/momentum/analog), retry'lı.
    // Light: geçmiş çekilmez → tech=null → fiyat-temelli proxy metriklere düşülür.
    const tech = deep ? await fetchHistoryWithRetry(yahooFinance, symbol) : null;

    try {
      const { shortCandidate, longCandidate, market } = buildCandidatePair(
        symbol, quote, summary, newsRows, referenceMs, tech
      );
      return [
        { symbol, horizon: 'short', market, data: shortCandidate },
        { symbol, horizon: 'long', market, data: longCandidate },
      ];
    } catch (err) {
      console.error(`[candidates] ${symbol}: ${err.message}`);
      return [];
    }
  });

  return nested.flat();
}

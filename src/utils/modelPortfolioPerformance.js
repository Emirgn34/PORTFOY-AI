/**
 * Model portföylerin TL bazlı, sabit başlangıç ağırlıklı performans
 * hesapları. Bu modül ağ veya tarih bağımlı değildir; collector ve arayüz
 * aynı hesaplama kurallarını kullanabilir.
 */

export const MODEL_PORTFOLIO_BENCHMARKS = Object.freeze([
  Object.freeze({ key: 'bist100', label: 'BIST 100', symbol: 'XU100.IS', currency: 'TRY' }),
  Object.freeze({ key: 'sp500', label: 'S&P 500', symbol: '^GSPC', currency: 'USD' }),
  Object.freeze({ key: 'nasdaq', label: 'NASDAQ', symbol: '^IXIC', currency: 'USD' }),
  Object.freeze({ key: 'gold', label: 'Altın', symbol: 'GC=F', currency: 'USD' }),
]);

function finiteNumber(value) {
  if (value == null || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value) {
  const parsed = finiteNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function round2(value) {
  if (!Number.isFinite(value)) return null;
  const sign = value < 0 ? -1 : 1;
  const rounded = sign * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function lookup(source, key) {
  if (!source || !key) return undefined;
  if (source instanceof Map) return source.get(key);
  if (typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, key)) {
    return source[key];
  }
  return undefined;
}

function priceFrom(value) {
  if (value && typeof value === 'object') {
    return positiveNumber(value.price ?? value.value ?? value.close);
  }
  return positiveNumber(value);
}

function currencyCode(value, fallback = 'TRY') {
  const code = String(value ?? fallback).trim().toUpperCase();
  return code || fallback;
}

function fxRatio(currency, baseFxByCurrency, fxByCurrency) {
  if (currency === 'TRY') return 1;
  const baseFx = positiveNumber(lookup(baseFxByCurrency, currency));
  const currentFx = positiveNumber(lookup(fxByCurrency, currency));
  if (baseFx == null || currentFx == null) return null;
  const ratio = currentFx / baseFx;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

/** BIST sembollerini Yahoo Finance biçimine getirir. */
export function toModelPortfolioMarketSymbol(holding) {
  const explicit = String(
    holding?.sourceSymbol ??
      holding?.source_symbol ??
      holding?.provenance?.sourceSymbol ??
      holding?.provenance?.source_symbol ??
      ''
  ).trim().toUpperCase();
  if (explicit) return explicit;
  const ticker = String(holding?.ticker ?? holding?.symbol ?? '').trim().toUpperCase();
  if (!ticker) return '';
  const market = String(holding?.market ?? '').trim().toUpperCase();
  return market === 'BIST' && !ticker.endsWith('.IS') ? `${ticker}.IS` : ticker;
}

/**
 * Sabit başlangıç ağırlıklı (buy-and-hold) TL NAV hesaplar.
 *
 * Bir holdingin fiyatı veya gerekli kuru yoksa o holding başlangıç değerinde
 * tutulur. Böylece eksik veri yapay kazanç/kayıp üretmez; coveragePct yalnızca
 * eksiksiz değerlenebilen yatırım ağırlığını gösterir. Nakit kapsam
 * paydasına girmez.
 */
export function calculateModelPortfolioSnapshot(
  portfolio,
  {
    priceBySymbol = {},
    fxByCurrency = {},
    benchmarkPriceByKey = {},
    splitFactorBySymbol = {},
  } = {}
) {
  const holdings = Array.isArray(portfolio?.holdings) ? portfolio.holdings : [];
  const tracking = portfolio?.tracking ?? {};
  const baseFxByCurrency = tracking.baseFxByCurrency ?? {};

  const validHoldings = holdings
    .map((holding) => ({ holding, weight: finiteNumber(holding?.weightPct) }))
    .filter(({ weight }) => weight != null && weight >= 0);
  const investedWeight = validHoldings.reduce((sum, item) => sum + item.weight, 0);
  const explicitCash = finiteNumber(portfolio?.cashWeightPct);
  const cashWeight = explicitCash != null && explicitCash >= 0
    ? explicitCash
    : Math.max(0, 100 - investedWeight);
  const baseNav = cashWeight + investedWeight;

  let rawNav = cashWeight;
  let coveredWeight = 0;

  for (const { holding, weight } of validHoldings) {
    const symbol = toModelPortfolioMarketSymbol(holding);
    const basePrice = positiveNumber(holding?.currentPriceAtGeneration);
    const currentPrice = priceFrom(lookup(priceBySymbol, symbol));
    const splitFactor = positiveNumber(lookup(splitFactorBySymbol, symbol)) ?? 1;
    const currency = currencyCode(holding?.currency);
    const holdingFxRatio = fxRatio(currency, baseFxByCurrency, fxByCurrency);
    const covered = basePrice != null && currentPrice != null && holdingFxRatio != null;

    if (!covered) {
      rawNav += weight;
      continue;
    }

    // Bölünmede fiyat mekanik olarak düşerken pay adedi aynı oranda artar.
    // Yahoo split olaylarından gelen kümülatif numerator/denominator çarpanı
    // fiyat oranına uygulanarak bu hareket getiri sanılmaz.
    const valueRatio = (currentPrice / basePrice) * splitFactor * holdingFxRatio;
    if (!Number.isFinite(valueRatio) || valueRatio <= 0) {
      rawNav += weight;
      continue;
    }

    rawNav += weight * valueRatio;
    coveredWeight += weight;
  }

  // Normal model portföylerde baseNav tam 100'dür. Normalizasyon, bozuk veya
  // eski kayıtlarda da endeksin başlangıcını 100'de tutar.
  const navValue = baseNav > 0 ? (rawNav / baseNav) * 100 : 100;
  const returnPct = navValue - 100;
  const coveragePct = investedWeight > 0 ? (coveredWeight / investedWeight) * 100 : 100;

  const benchmarks = {};
  const baselines = tracking.benchmarkBaselines ?? {};
  for (const definition of MODEL_PORTFOLIO_BENCHMARKS) {
    const { key } = definition;
    const baseline = lookup(baselines, key);
    const basePrice = priceFrom(baseline);
    const currentPrice = priceFrom(lookup(benchmarkPriceByKey, key));
    const currency = currencyCode(baseline?.currency, definition.currency);
    const benchmarkFxRatio = fxRatio(currency, baseFxByCurrency, fxByCurrency);

    if (basePrice == null || currentPrice == null || benchmarkFxRatio == null) {
      benchmarks[key] = null;
      continue;
    }

    const normalizedReturn = ((currentPrice / basePrice) * benchmarkFxRatio - 1) * 100;
    benchmarks[key] = round2(normalizedReturn);
  }

  return {
    navValue: round2(navValue),
    returnPct: round2(returnPct),
    coveragePct: round2(Math.min(100, Math.max(0, coveragePct))),
    benchmarks,
  };
}

function normalizeDate(value) {
  if (value == null || value === '') return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function benchmarkObject(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Aktif model sürümlerinin NAV satırlarını Recharts'a uygun geniş tarih
 * satırlarına dönüştürür. Eski versionKey satırları bilinçli olarak
 * grafiğe alınmaz.
 */
export function buildModelPortfolioChartData(portfolios, navRows) {
  const slugByVersion = new Map();
  for (const portfolio of Array.isArray(portfolios) ? portfolios : []) {
    const slug = String(portfolio?.slug ?? '').trim();
    const versionKey = String(
      portfolio?.versionKey ?? portfolio?.version_key ?? portfolio?.tracking?.versionKey ?? ''
    ).trim();
    if (slug && versionKey) slugByVersion.set(versionKey, slug);
  }

  const rowsByDate = new Map();
  for (const row of Array.isArray(navRows) ? navRows : []) {
    const versionKey = String(row?.version_key ?? row?.versionKey ?? '').trim();
    const slug = slugByVersion.get(versionKey);
    const date = normalizeDate(row?.nav_date ?? row?.navDate);
    if (!slug || !date) continue;

    const chartRow = rowsByDate.get(date) ?? { date };
    const portfolioReturn = finiteNumber(row?.return_pct ?? row?.returnPct);
    if (portfolioReturn != null) chartRow[slug] = round2(portfolioReturn);

    const rowBenchmarks = benchmarkObject(row?.benchmarks);
    if (rowBenchmarks) {
      for (const { key } of MODEL_PORTFOLIO_BENCHMARKS) {
        const raw = rowBenchmarks[key];
        const benchmarkReturn = finiteNumber(
          raw && typeof raw === 'object' ? raw.returnPct ?? raw.return_pct ?? raw.value : raw
        );
        if (benchmarkReturn != null) chartRow[key] = round2(benchmarkReturn);
      }
    }

    rowsByDate.set(date, chartRow);
  }

  return [...rowsByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

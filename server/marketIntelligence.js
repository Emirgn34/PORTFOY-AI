import { mapLimit } from './concurrency.js';

function num(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object' && typeof value.raw === 'number') return value.raw;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pct(value) {
  const parsed = num(value);
  return parsed == null ? null : Number((parsed * 100).toFixed(1));
}

function isoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function earningsDateOf(calendarEvents) {
  const raw = calendarEvents?.earnings?.earningsDate;
  const first = Array.isArray(raw) ? raw[0] : raw;
  return isoDate(first);
}

export function selectOptionExpiration(expirationDates, earningsDate) {
  const dates = (expirationDates ?? [])
    .map((value) => (value instanceof Date ? value : new Date(value)))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a - b);
  if (!dates.length) return null;
  if (!earningsDate) return dates[0];
  const eventTime = new Date(earningsDate).getTime();
  if (!Number.isFinite(eventTime)) return dates[0];
  return dates.find((date) => date.getTime() >= eventTime) ?? dates[dates.length - 1];
}

function nearestAtm(options, price) {
  const chain = options?.options?.[0];
  if (!chain || !price) return null;
  const nearest = (contracts = []) =>
    [...contracts]
      .filter((contract) => num(contract.strike) != null)
      .sort((a, b) => Math.abs(num(a.strike) - price) - Math.abs(num(b.strike) - price))[0] ?? null;
  const call = nearest(chain.calls);
  const put = nearest(chain.puts);
  const ivs = [num(call?.impliedVolatility), num(put?.impliedVolatility)].filter((value) => value != null);
  if (!ivs.length) return null;
  const iv = ivs.reduce((sum, value) => sum + value, 0) / ivs.length;
  const expiration = isoDate(chain.expirationDate ?? options?.expirationDates?.[0]);
  const days = expiration ? Math.max(1, (new Date(expiration) - Date.now()) / 86_400_000) : 30;
  return {
    impliedVolatilityPct: Number((iv * 100).toFixed(1)),
    expectedMovePct: Number((iv * Math.sqrt(days / 365) * 100).toFixed(1)),
    expiration,
    strike: num(call?.strike) ?? num(put?.strike),
    callOpenInterest: num(call?.openInterest),
    putOpenInterest: num(put?.openInterest),
  };
}

export async function getMarketIntelligence(yahooFinance, symbols, { includeOptions = true } = {}) {
  const unique = [...new Set(symbols.map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean))].slice(0, 20);
  const items = await mapLimit(unique, 4, async (symbol) => {
    let summary = null;
    try {
      summary = await yahooFinance.quoteSummary(symbol, {
        modules: [
          'price',
          'summaryDetail',
          'defaultKeyStatistics',
          'financialData',
          'calendarEvents',
          'earningsTrend',
          'assetProfile',
        ],
      });
    } catch (error) {
      return { symbol, error: error.message };
    }
    const price = num(summary?.price?.regularMarketPrice);
    const earningsDate = earningsDateOf(summary?.calendarEvents ?? {});
    let optionsSnapshot = null;
    if (includeOptions && !symbol.endsWith('.IS')) {
      try {
        const overview = await yahooFinance.options(symbol);
        const selectedExpiration = selectOptionExpiration(overview?.expirationDates, earningsDate);
        const firstExpiration = isoDate(overview?.options?.[0]?.expirationDate);
        const selectedIso = isoDate(selectedExpiration);
        const chain =
          selectedExpiration && selectedIso !== firstExpiration
            ? await yahooFinance.options(symbol, { date: selectedExpiration })
            : overview;
        optionsSnapshot = nearestAtm(chain, price);
        if (optionsSnapshot) {
          optionsSnapshot.coversEarnings = Boolean(
            earningsDate && optionsSnapshot.expiration &&
              new Date(optionsSnapshot.expiration).getTime() >= new Date(earningsDate).getTime()
          );
          optionsSnapshot.basis = earningsDate ? 'earnings-covering-expiration' : 'nearest-expiration';
        }
      } catch {
        optionsSnapshot = null;
      }
    }
    const financial = summary?.financialData ?? {};
    const stats = summary?.defaultKeyStatistics ?? {};
    const detail = summary?.summaryDetail ?? {};
    const calendar = summary?.calendarEvents ?? {};
    const trend = summary?.earningsTrend?.trend?.[0] ?? null;
    return {
      symbol,
      ticker: symbol.replace(/\.IS$/, ''),
      companyName: summary?.price?.longName ?? summary?.price?.shortName ?? symbol,
      sector: summary?.assetProfile?.sector ?? null,
      industry: summary?.assetProfile?.industry ?? null,
      currency: summary?.price?.currency ?? (symbol.endsWith('.IS') ? 'TRY' : 'USD'),
      price,
      fundamentals: {
        trailingPE: num(detail.trailingPE),
        forwardPE: num(stats.forwardPE ?? financial.forwardPE),
        pegRatio: num(stats.pegRatio),
        priceToBook: num(stats.priceToBook),
        debtToEquity: num(financial.debtToEquity),
        revenueGrowthPct: pct(financial.revenueGrowth),
        earningsGrowthPct: pct(financial.earningsGrowth),
        profitMarginPct: pct(financial.profitMargins),
      },
      earnings: {
        date: earningsDate,
        epsEstimate: num(calendar?.earnings?.earningsAverage ?? trend?.earningsEstimate?.avg),
        epsLow: num(calendar?.earnings?.earningsLow ?? trend?.earningsEstimate?.low),
        epsHigh: num(calendar?.earnings?.earningsHigh ?? trend?.earningsEstimate?.high),
        revenueEstimate: num(calendar?.earnings?.revenueAverage ?? trend?.revenueEstimate?.avg),
        analystCount: num(trend?.earningsEstimate?.numberOfAnalysts),
      },
      analyst: {
        targetMean: num(financial.targetMeanPrice),
        targetLow: num(financial.targetLowPrice),
        targetHigh: num(financial.targetHighPrice),
        recommendation: financial.recommendationKey ?? null,
        analystCount: num(financial.numberOfAnalystOpinions),
      },
      options: optionsSnapshot,
      fetchedAt: new Date().toISOString(),
      source: 'Yahoo Finance (MVP, gayriresmî)',
    };
  });
  return { items, fetchedAt: new Date().toISOString() };
}

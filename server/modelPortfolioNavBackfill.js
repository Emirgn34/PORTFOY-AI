import {
  calculateModelPortfolioSnapshot,
  toModelPortfolioMarketSymbol,
} from '../src/utils/modelPortfolioPerformance.js';
import { getModelPortfolioCashAcquisition } from '../src/utils/modelPortfolioCorporateActions.js';

const DAY = 86_400_000;
const startedAt = (version) => version.data?.tracking?.startedAt ?? version.cycle_start;

function splits(history) {
  const events = history?.events?.splits ?? [];
  return (Array.isArray(events) ? events : Object.values(events)).map((event) => {
    const time = typeof event.date === 'number' ? event.date * 1000 : Date.parse(event.date);
    const ratio = Number(event.numerator) / Number(event.denominator);
    if (!Number.isFinite(time) || !(ratio > 0) || !Number.isFinite(ratio)) {
      throw new Error('Geçersiz tarihsel split olayı; NAV onarımı durduruldu.');
    }
    return { time, ratio };
  });
}

// Daily US equity bars are timestamped at the session open. Only completed
// sessions may be used. FX daily bars finish 24 hours after their timestamp.
function historicalPrice(history, symbol, asOf) {
  const cutoff = Date.parse(asOf);
  const sessionLength = symbol.endsWith('=X') ? DAY : 6.5 * 3_600_000;
  const eligible = (history?.quotes ?? [])
    .filter((row) => Number.isFinite(row.close) && row.close > 0 &&
      new Date(row.date).getTime() + sessionLength <= cutoff)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const last = eligible.at(-1);
  if (!last || cutoff - new Date(last.date).getTime() > 5 * DAY) {
    throw new Error(`${symbol}: ${asOf} öncesinde yeterince güncel kapanış yok.`);
  }
  const time = new Date(last.date).getTime();
  // Yahoo closes are split-adjusted. Undo subsequent splits to recover the
  // raw price at that session; the NAV engine applies splits since inception.
  const futureFactor = splits(history).filter((event) => event.time > time)
    .reduce((factor, event) => factor * event.ratio, 1);
  return { price: last.close * futureFactor, sourceDate: new Date(last.date).toISOString() };
}

export function modelPortfolioBackfillSymbols(versions, asOf) {
  const symbols = new Set();
  for (const version of versions) {
    for (const holding of version.data?.holdings ?? []) {
      const symbol = toModelPortfolioMarketSymbol(holding);
      if (!getModelPortfolioCashAcquisition(symbol, startedAt(version), asOf)) symbols.add(symbol);
      if (holding.currency !== 'TRY') symbols.add(`${holding.currency}TRY=X`);
    }
  }
  return [...symbols].sort();
}

export function buildMissingModelPortfolioNavRows({ versions, navRows, histories, now }) {
  if (versions.length !== 4 || new Set(versions.map((v) => v.slug)).size !== 4 ||
      new Set(versions.map((v) => v.cycle_start)).size !== 1) {
    throw new Error('Onarım için aynı dönemdeki dört benzersiz portföy gerekli.');
  }
  const keys = new Set(versions.map((v) => v.version_key));
  const existing = new Set(navRows.map((row) => `${row.version_key}:${row.nav_date}`));
  const dates = [...new Set(navRows.filter((row) => keys.has(row.version_key))
    .map((row) => row.nav_date))].sort();
  const rows = [];
  for (const navDate of dates) {
    // Reconstructed daily records use completed closes as of 03:00 Istanbul.
    const asOf = `${navDate}T00:00:00.000Z`;
    if (Date.parse(asOf) > Date.parse(now)) continue;
    for (const version of versions) {
      if (existing.has(`${version.version_key}:${navDate}`) ||
          Date.parse(asOf) <= Date.parse(version.cycle_start) ||
          Date.parse(asOf) >= Date.parse(version.cycle_end)) continue;
      const priceBySymbol = {};
      const fxByCurrency = { TRY: 1 };
      const splitFactorBySymbol = {};
      const sourceDates = {};
      for (const holding of version.data.holdings) {
        const symbol = toModelPortfolioMarketSymbol(holding);
        if (!getModelPortfolioCashAcquisition(symbol, startedAt(version), asOf)) {
          const point = historicalPrice(histories[symbol], symbol, asOf);
          priceBySymbol[symbol] = point.price;
          sourceDates[symbol] = point.sourceDate;
          splitFactorBySymbol[symbol] = splits(histories[symbol])
            .filter((event) => event.time > Date.parse(startedAt(version)) && event.time <= Date.parse(asOf))
            .reduce((factor, event) => factor * event.ratio, 1);
        }
        if (holding.currency !== 'TRY' && fxByCurrency[holding.currency] == null) {
          const fxSymbol = `${holding.currency}TRY=X`;
          const point = historicalPrice(histories[fxSymbol], fxSymbol, asOf);
          fxByCurrency[holding.currency] = point.price;
          sourceDates[fxSymbol] = point.sourceDate;
        }
      }
      const snapshot = calculateModelPortfolioSnapshot(version.data, {
        priceBySymbol, fxByCurrency, splitFactorBySymbol, observedAt: asOf,
      });
      if (snapshot.coveragePct < 99.99 || !(snapshot.navValue > 0)) {
        throw new Error(`${version.slug} ${navDate}: eksik kapsam; onarım yazılmadı.`);
      }
      rows.push({
        version_key: version.version_key, nav_date: navDate, observed_at: asOf,
        nav_value: snapshot.navValue, return_pct: snapshot.returnPct, coverage_pct: snapshot.coveragePct,
        benchmarks: { _valuation: { method: 'historical-close-reconstruction-v1', source: 'Yahoo Finance',
          asOf, reconstructedAt: now, sourceDates } },
      });
    }
  }
  return rows;
}

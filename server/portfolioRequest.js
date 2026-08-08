import { sha256 } from './aiControl.js';

export const MAX_PORTFOLIO_HOLDINGS = 40;
const MAX_NUMBER = 1_000_000_000_000;
const TICKER_RE = /^[A-Z0-9.\-^=]{1,24}$/;
const ALLOWED_CURRENCIES = new Set(['TRY', 'USD', 'EUR', 'GBP']);

function cleanText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function cleanNumber(value, { required = false, min = 0, max = MAX_NUMBER } = {}) {
  if (value == null || value === '') {
    if (required) throw new Error('Zorunlu sayısal alan eksik.');
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error('Geçersiz sayısal değer.');
  return n;
}

export function normalizeHoldings(input) {
  if (!Array.isArray(input) || input.length === 0) throw new Error('Portföy boş.');
  if (input.length > MAX_PORTFOLIO_HOLDINGS) {
    throw new Error(`Bir analizde en fazla ${MAX_PORTFOLIO_HOLDINGS} hisse kullanılabilir.`);
  }

  const seen = new Set();
  return input.map((holding) => {
    const ticker = cleanText(holding?.ticker, 24).toUpperCase();
    if (!TICKER_RE.test(ticker)) throw new Error(`Geçersiz hisse kodu: ${ticker || 'boş'}`);
    const market = cleanText(holding?.market, 20) || (ticker.endsWith('.IS') ? 'BIST' : 'US');
    const key = `${market.toUpperCase()}|${ticker}`;
    if (seen.has(key)) throw new Error(`Aynı hisse portföyde birden fazla kez bulunamaz: ${ticker}`);
    seen.add(key);

    const currencyRaw = cleanText(holding?.currency, 3).toUpperCase();
    const currency = ALLOWED_CURRENCIES.has(currencyRaw)
      ? currencyRaw
      : market.toUpperCase().includes('BIST')
        ? 'TRY'
        : 'USD';

    return {
      ticker,
      company: cleanText(holding?.company, 120),
      market,
      quantity: cleanNumber(holding?.quantity, { required: true, min: 0.00000001 }),
      avgPrice: cleanNumber(holding?.avgPrice, { min: 0 }),
      currentPrice: cleanNumber(holding?.currentPrice, { min: 0 }),
      currency,
      sector: cleanText(holding?.sector, 80),
    };
  });
}

export function portfolioFingerprint(holdings) {
  const material = holdings
    .map((holding) => ({
      ticker: holding.ticker,
      market: holding.market,
      quantity: holding.quantity,
      avgPrice: holding.avgPrice,
      currency: holding.currency,
    }))
    .sort((a, b) => `${a.market}|${a.ticker}`.localeCompare(`${b.market}|${b.ticker}`));
  return sha256(JSON.stringify(material));
}

export function isFreshPortfolioCache(analysis, fingerprint, hours = 6, now = Date.now()) {
  if (!analysis || analysis.portfolioFingerprint !== fingerprint) return false;
  const generatedAt = new Date(analysis.generatedAt).getTime();
  if (!Number.isFinite(generatedAt)) return false;
  return now - generatedAt < Math.max(0, Number(hours) || 0) * 3_600_000;
}

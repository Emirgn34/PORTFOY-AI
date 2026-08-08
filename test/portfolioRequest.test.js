import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isFreshPortfolioCache,
  normalizeHoldings,
  portfolioFingerprint,
} from '../server/portfolioRequest.js';

const holdings = [
  { ticker: 'THYAO', market: 'BIST', quantity: 10, avgPrice: 200, currentPrice: 250, currency: 'TRY' },
  { ticker: 'AAPL', market: 'US', quantity: 2, avgPrice: 180, currentPrice: 210, currency: 'USD' },
];

test('fingerprint sıralama ve anlık fiyat değişiminden etkilenmez', () => {
  const normalized = normalizeHoldings(holdings);
  const changedPrices = normalizeHoldings(
    [...holdings].reverse().map((holding) => ({ ...holding, currentPrice: holding.currentPrice * 2 }))
  );
  assert.equal(portfolioFingerprint(normalized), portfolioFingerprint(changedPrices));
});

test('tekrarlanan hisseyi reddeder', () => {
  assert.throws(
    () => normalizeHoldings([holdings[0], { ...holdings[0] }]),
    /birden fazla/
  );
});

test('yalnızca aynı fingerprint ve süre içindeki analizi taze sayar', () => {
  const fingerprint = portfolioFingerprint(normalizeHoldings(holdings));
  const now = Date.parse('2026-08-09T12:00:00Z');
  const analysis = { portfolioFingerprint: fingerprint, generatedAt: '2026-08-09T08:00:00Z' };
  assert.equal(isFreshPortfolioCache(analysis, fingerprint, 6, now), true);
  assert.equal(isFreshPortfolioCache(analysis, fingerprint, 3, now), false);
  assert.equal(isFreshPortfolioCache(analysis, 'different', 6, now), false);
});

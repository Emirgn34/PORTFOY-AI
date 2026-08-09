import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessGenerationCompleteness,
  selectMarketBalancedSymbols,
} from '../server/candidateSelection.js';

function row(symbol, market, horizon, score) {
  const ticker = symbol.replace(/\.IS$/, '');
  return {
    symbol,
    market,
    horizon,
    data: {
      id: `${horizon}-${ticker}`,
      symbol: ticker,
      market,
      averageNewsReliability: 8,
      riskLevel: 'Orta',
      catalystDate: '2026-08-09T00:00:00.000Z',
      scoreBreakdown:
        horizon === 'short'
          ? {
              newsCatalystScore: score,
              newsReliabilityScore: score,
              technicalMomentumScore: score,
              volumeConfirmationScore: score,
              riskAdjustedScore: score,
              liquidityScore: score,
              sectorMarketFitScore: score,
            }
          : {
              fundamentalHealthScore: score,
              valuationScore: score,
              growthScore: score,
              dividendScore: score,
              sectorTrendScore: score,
              riskAdjustedScore: score,
              newsReliabilityScore: score,
            },
    },
  };
}

test('piyasa dengeli seçim daha yüksek ABD skorlarına rağmen BIST kotasını korur', () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => row(`US${i}`, 'US', 'short', 95 - i)),
    ...Array.from({ length: 10 }, (_, i) => row(`BI${i}.IS`, 'BIST', 'short', 55 - i)),
  ];
  const selected = selectMarketBalancedSymbols(rows, 'short', {
    total: 10,
    bistShare: 0.4,
    referenceMs: Date.parse('2026-08-09T00:00:00.000Z'),
  });
  assert.equal(selected.length, 10);
  assert.equal(selected.filter((symbol) => symbol.endsWith('.IS')).length, 4);
});

test('jenerasyon eksikse yayımlamaya izin vermez', () => {
  const planned = ['AAPL', 'MSFT', 'NVDA', 'THYAO.IS', 'ASELS.IS', 'SISE.IS'];
  const partial = [
    { symbol: 'AAPL' },
    { symbol: 'MSFT' },
    { symbol: 'THYAO.IS' },
  ];
  const result = assessGenerationCompleteness(planned, partial);
  assert.equal(result.ok, false);
  assert.equal(result.actual, 3);
});

test('yeterli ve pazar dengeli jenerasyon geçer', () => {
  const planned = ['AAPL', 'MSFT', 'NVDA', 'THYAO.IS', 'ASELS.IS', 'SISE.IS'];
  const rows = planned.map((symbol) => ({ symbol }));
  assert.equal(assessGenerationCompleteness(planned, rows).ok, true);
});

test('BIST 100 fallback evreni benzersiz ve Yahoo biçimindedir', async () => {
  const { BIST_100_SYMBOLS, BIST_SCAN_SYMBOLS } = await import('../server/bistUniverse.js');
  assert.equal(BIST_100_SYMBOLS.length, 100);
  assert.equal(new Set(BIST_100_SYMBOLS).size, 100);
  assert.ok(BIST_100_SYMBOLS.every((symbol) => /^[A-Z0-9]+\.IS$/.test(symbol)));
  assert.ok(BIST_SCAN_SYMBOLS.length >= 100);
  assert.ok(BIST_SCAN_SYMBOLS.includes('AGHOL.IS'));
});

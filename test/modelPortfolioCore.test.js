import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelPortfolios } from '../src/utils/modelPortfolioCore.js';

function candidate(index, horizon, overrides = {}) {
  const tech = overrides.tech ?? false;
  return {
    id: `${horizon}-${index}`,
    symbol: `S${index}`,
    companyName: `Şirket ${index}`,
    market: index % 2 ? 'BIST' : 'NASDAQ',
    sector: tech ? 'Technology' : `Sektör ${index % 4}`,
    industry: tech ? 'Semiconductors' : 'Industrials',
    currency: index % 2 ? 'TRY' : 'USD',
    currentPrice: 100 + index,
    analysisDepth: 'deep',
    riskLevel: overrides.riskLevel ?? (index % 3 === 0 ? 'Düşük' : 'Orta'),
    liquidityLevel: 'Yüksek',
    catalystDate: '2026-08-09T00:00:00.000Z',
    averageNewsReliability: 8,
    volumeSignal: 'Güçlü Hacim',
    priceStructure: {
      supports: [{ level: 96 + index, touches: 4, distancePct: -4 }],
      bandLow: 95 + index,
    },
    expectation: { hasActionableEdge: true, expectedReturnPct: 12, expectedPrice: 112 + index, horizonLabel: '~1 yıl' },
    conviction: { score: 68, evidence: [{ text: 'Doğrulanmış olay kanıtı.' }] },
    scoreBreakdown:
      horizon === 'short'
        ? { newsCatalystScore: 70, newsReliabilityScore: 75, technicalMomentumScore: 72, expectedReturnScore: 65, volumeConfirmationScore: 70, riskAdjustedScore: 70, liquidityScore: 80, sectorMarketFitScore: 65 }
        : { fundamentalHealthScore: 75, valuationScore: 65, growthScore: 72, expectedReturnScore: 65, dividendScore: 62, sectorTrendScore: 68, riskAdjustedScore: 72, newsReliabilityScore: 75 },
  };
}

test('dört sabit model portföyü risk sırasıyla üretir', () => {
  const long = Array.from({ length: 16 }, (_, index) => candidate(index, 'long', { tech: index < 8 }));
  const short = Array.from({ length: 10 }, (_, index) => candidate(index + 20, 'short', { riskLevel: 'Yüksek' }));
  const result = buildModelPortfolios({ shortCandidates: short, longCandidates: long, generatedAt: '2026-08-09T00:00:00.000Z', sourceGeneration: 1 });
  assert.equal(result.length, 4);
  assert.deepEqual(result.map((portfolio) => portfolio.riskTier), [1, 2, 3, 4]);
  assert.deepEqual(result.map((portfolio) => portfolio.slug), ['quality-defense', 'balanced-growth', 'technology-growth', 'short-momentum']);
});

test('ağırlıklar ve nakit toplamı yüzde 100 olur, giriş planı üretilir', () => {
  const long = Array.from({ length: 16 }, (_, index) => candidate(index, 'long', { tech: index < 8 }));
  const short = Array.from({ length: 8 }, (_, index) => candidate(index + 20, 'short', { riskLevel: 'Yüksek' }));
  for (const portfolio of buildModelPortfolios({ shortCandidates: short, longCandidates: long, generatedAt: '2026-08-09T00:00:00.000Z' })) {
    const total = portfolio.holdings.reduce((sum, holding) => sum + holding.weightPct, 0) + portfolio.cashWeightPct;
    assert.equal(Number(total.toFixed(1)), 100);
    assert.ok(portfolio.holdings.every((holding) => holding.entryPlan.low < holding.entryPlan.high));
  }
});

test('uygun aday azsa eşik gevşetmek yerine nakit ve uyarı bırakır', () => {
  const result = buildModelPortfolios({ longCandidates: [candidate(1, 'long')], shortCandidates: [] });
  const balanced = result.find((portfolio) => portfolio.slug === 'balanced-growth');
  assert.ok(balanced.cashWeightPct > 50);
  assert.ok(balanced.warnings.length > 0);
});


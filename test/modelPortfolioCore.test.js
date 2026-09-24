import test from 'node:test';
import assert from 'node:assert/strict';
import { addUtcMonths, buildModelPortfolios } from '../src/utils/modelPortfolioCore.js';

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

test('aylık vade ile altı saatlik veri tazeliğini birbirinden ayırır', () => {
  const generatedAt = '2026-01-31T12:30:00.000Z';
  const [portfolio] = buildModelPortfolios({
    longCandidates: [candidate(1, 'long')],
    generatedAt,
    sourceGeneration: 42,
  });

  assert.equal(addUtcMonths(generatedAt), '2026-02-28T12:30:00.000Z');
  assert.equal(portfolio.cycleStart, generatedAt);
  assert.equal(portfolio.cycleEnd, '2026-02-28T12:30:00.000Z');
  assert.equal(portfolio.dataFreshUntil, '2026-01-31T18:30:00.000Z');
  assert.equal(portfolio.validUntil, portfolio.dataFreshUntil);
  assert.equal(portfolio.rebalanceFrequency, 'monthly');
  assert.match(portfolio.versionKey, /^quality-defense--2026-01-31/);
});

test('30 günlük analiz geçmişini kullanır, uygun önceki hisseyi taşır ve önem sırasını yazar', () => {
  const generatedAt = '2026-09-01T00:00:00.000Z';
  const longCandidates = Array.from({ length: 6 }, (_, index) =>
    candidate(index + 1, 'long')
  );
  const analysisHistory = longCandidates.flatMap((item, index) => [
    {
      generation: 1,
      source_symbol: item.market === 'BIST' ? `${item.symbol}.IS` : item.symbol,
      symbol: item.symbol,
      market: item.market,
      horizon: 'long',
      captured_at: '2026-08-20T00:00:00.000Z',
      profile_scores: { 'balanced-growth': 82 - index },
      eligibility: { 'balanced-growth': true },
    },
    {
      generation: 2,
      source_symbol: item.market === 'BIST' ? `${item.symbol}.IS` : item.symbol,
      symbol: item.symbol,
      market: item.market,
      horizon: 'long',
      captured_at: '2026-08-27T00:00:00.000Z',
      profile_scores: { 'balanced-growth': 84 - index },
      eligibility: { 'balanced-growth': true },
    },
  ]);

  const balanced = buildModelPortfolios({
    longCandidates,
    generatedAt,
    analysisHistory,
    previousPortfolios: [
      { slug: 'balanced-growth', holdings: [{ ticker: 'S2', market: 'NASDAQ' }] },
    ],
  }).find((portfolio) => portfolio.slug === 'balanced-growth');

  assert.equal(balanced.selection.method, 'rolling-30d-consensus-v1');
  assert.equal(balanced.selection.carriedHoldingCount, 1);
  assert.equal(
    balanced.holdings.find((holding) => holding.ticker === 'S2')?.carriedFromPrevious,
    true
  );
  assert.equal(balanced.holdings.find((holding) => holding.ticker === 'S2')?.sourceSymbol, 'S2');
  assert.equal(
    balanced.holdings.find((holding) => holding.ticker === 'S2')?.provenance?.sourceSymbol,
    'S2'
  );
  assert.deepEqual(
    balanced.holdings.map((holding) => holding.modelImportanceRank),
    balanced.holdings.map((_, index) => index + 1)
  );
  assert.ok(
    balanced.holdings.every(
      (holding, index, rows) =>
        index === 0 || rows[index - 1].modelImportanceScore >= holding.modelImportanceScore
    )
  );
});

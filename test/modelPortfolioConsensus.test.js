import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_PORTFOLIO_CONSENSUS_DEFAULTS,
  assessMonthlyConsensusCoverage,
  buildMonthlyConsensusCandidates,
  buildMonthlyConsensusSelection,
  compactModelPortfolioObservation,
  selectMonthlyConsensusCandidates,
} from '../src/utils/modelPortfolioConsensus.js';

const profile = {
  slug: 'balanced-growth',
  horizon: 'long',
  targetCount: 4,
};

function live(symbol, liveScore, overrides = {}) {
  return {
    id: `${symbol}-long`,
    symbol,
    horizon: 'long',
    generation: 400,
    liveScore,
    eligible: true,
    ...overrides,
  };
}

function observation(symbol, generation, capturedAt, score, eligible = true, overrides = {}) {
  return {
    source_symbol: symbol,
    symbol,
    horizon: 'long',
    generation,
    captured_at: capturedAt,
    profile_scores: { 'balanced-growth': score },
    eligibility: { 'balanced-growth': eligible },
    ...overrides,
  };
}

test('compact observation keeps the immutable fields needed by monthly ranking', () => {
  const result = compactModelPortfolioObservation({
    symbol: 'thyao',
    horizon: 'long',
    generation: 42,
    capturedAt: '2026-01-10T12:00:00.000Z',
    expectedReturn: 18.5,
    conviction: { score: 73 },
    profileScores: { 'balanced-growth': 81.234 },
    profileEligibility: { 'balanced-growth': true },
    factorScores: { quality: 110, valuation: -3 },
  });

  assert.deepEqual(result, {
    sourceSymbol: 'THYAO',
    symbol: 'THYAO',
    horizon: 'long',
    capturedAt: '2026-01-10T12:00:00.000Z',
    generation: 42,
    score: null,
    profileScores: { 'balanced-growth': 81.234 },
    factorScores: { quality: 100, valuation: 0 },
    profileEligibility: { 'balanced-growth': true },
    risk: null,
    liquidity: null,
    expectedReturn: 18.5,
    conviction: 73,
    data: null,
  });
});

test('resmi aylık sepet tek taramayla açılmaz; iki vadede yeterli geçmiş ister', () => {
  const oneScan = ['short', 'long'].map((horizon) => ({
    generation: 1,
    horizon,
    captured_at: '2026-01-31T00:00:00.000Z',
  }));
  assert.equal(assessMonthlyConsensusCoverage(oneScan).ok, false);

  const sufficient = [];
  for (let index = 0; index < 20; index += 1) {
    for (const horizon of ['short', 'long']) {
      sufficient.push({
        generation: index + 1,
        horizon,
        captured_at: new Date(Date.UTC(2026, 0, 1) + index * 9 * 60 * 60 * 1000).toISOString(),
      });
    }
  }
  const result = assessMonthlyConsensusCoverage(sufficient);
  assert.equal(result.ok, true);
  assert.ok(result.horizons.every((item) => item.generationCount === 20));
  assert.ok(result.horizons.every((item) => item.spanDays >= 7));
});

test('30-day consensus uses distinct scan episodes and the documented 50/25/15/10 formula', () => {
  const asOf = '2026-01-31T00:00:00.000Z';
  const history = [
    observation('AAA', 100, '2026-01-17T00:00:00.000Z', 40, false),
    observation('AAA', 200, '2026-01-24T00:00:00.000Z', 60, true),
    observation('AAA', 300, '2026-01-30T00:00:00.000Z', 100, true),
    // Same generation is one episode. The stronger duplicate is retained.
    observation('AAA', 200, '2026-01-24T00:00:00.000Z', 55, true),
    // These rows must not enlarge the episode denominator.
    observation('AAA', 50, '2025-12-31T23:59:59.000Z', 100, true),
    observation('AAA', 500, '2026-02-01T00:00:00.000Z', 100, true),
    observation('AAA', 600, '2026-01-29T00:00:00.000Z', 100, true, { horizon: 'short' }),
  ];

  const ranked = buildMonthlyConsensusCandidates({
    profile,
    currentCandidates: [live('AAA', 80), live('BBB', 50), live('OLD', 99, { eligible: false })],
    observations: [...history, observation('HISTORY_ONLY', 300, '2026-01-30T00:00:00.000Z', 100)],
    asOf,
    getProfileScore: (candidate) => candidate.liveScore,
    isEligible: (candidate) => candidate.eligible,
  });

  assert.deepEqual(ranked.map((candidate) => candidate.symbol), ['AAA', 'BBB']);
  const aaa = ranked[0];
  assert.equal(aaa.observationStats.totalWindowEpisodes, 4);
  assert.equal(aaa.observationStats.observationCount, 4);
  assert.equal(aaa.observationStats.eligibleObservationCount, 3);
  assert.equal(aaa.observationStats.persistenceScore, 75);
  assert.equal(aaa.observationStats.medianScore, 70);
  assert.equal(aaa.observationStats.latestScore, 80);

  const weighted = (40 * 0.25 + 60 * 0.5 + 100 * 2 ** (-1 / 7) + 80) /
    (0.25 + 0.5 + 2 ** (-1 / 7) + 1);
  const expected =
    weighted * 0.5 +
    70 * 0.25 +
    75 * 0.15 +
    80 * 0.1;
  assert.equal(aaa.observationStats.recencyWeightedScore, Number(weighted.toFixed(2)));
  assert.equal(aaa.consensusScore, Number(expected.toFixed(2)));
  assert.equal(aaa.modelImportanceRank, 1);

  // `getProfileScore` scores only live rows. Historical compact rows are read
  // from their persisted profile_scores rather than incorrectly becoming zero.
  assert.ok(aaa.observationStats.recencyWeightedScore > 60);
});

test('light historical rows count as missing persistence but do not distort score averages', () => {
  const result = buildMonthlyConsensusSelection({
    profile,
    currentCandidates: [live('A', 80)],
    observations: [
      observation('A', 1, '2026-01-29T00:00:00.000Z', 20, true, {
        analysis_depth: 'deep',
      }),
      observation('A', 2, '2026-01-30T00:00:00.000Z', 100, true, {
        analysis_depth: 'light',
      }),
    ],
    asOf: '2026-01-31T00:00:00.000Z',
    scoreCandidate: (candidate) => candidate.liveScore,
    isCurrentEligible: (candidate) => candidate.eligible,
  });

  const candidate = result.rankedCandidates[0];
  assert.equal(candidate.observationStats.totalWindowEpisodes, 3);
  assert.equal(candidate.observationStats.historicalObservationCount, 1);
  assert.ok(candidate.observationStats.recencyWeightedScore < 80);
  assert.ok(candidate.observationStats.recencyWeightedScore > 20);
});

test('a symbol must still exist and pass the current hard gate', () => {
  const ranked = buildMonthlyConsensusCandidates({
    profile,
    currentCandidates: [
      live('GOOD', 70),
      live('BLOCKED', 99, { eligible: false }),
    ],
    observations: [
      observation('GOOD', 1, '2026-01-30T00:00:00.000Z', 65),
      observation('BLOCKED', 1, '2026-01-30T00:00:00.000Z', 100),
      observation('HISTORY_ONLY', 1, '2026-01-30T00:00:00.000Z', 100),
    ],
    asOf: '2026-01-31T00:00:00.000Z',
    scoreCandidate: (candidate) => candidate.liveScore,
    isCurrentEligible: (candidate) => candidate.eligible,
  });

  assert.deepEqual(ranked.map((candidate) => candidate.symbol), ['GOOD']);
});

test('carryover applies the five-point challenger margin and normal turnover cap', () => {
  const incumbents = 'ABCDEFGH'.split('');
  const candidates = [
    { symbol: 'X', consensusScore: 100 },
    { symbol: 'Y', consensusScore: 99 },
    ...incumbents.map((symbol, index) => ({ symbol, consensusScore: 90 - index })),
  ];
  const selected = selectMonthlyConsensusCandidates({
    candidates,
    targetCount: 8,
    previousPortfolio: { holdings: incumbents.map((ticker) => ({ ticker })) },
    challengerMargin: 5,
    maxNormalTurnover: 1,
  });

  assert.equal(selected.length, 8);
  assert.ok(selected.some((candidate) => candidate.symbol === 'X'));
  assert.ok(!selected.some((candidate) => candidate.symbol === 'Y'));
  assert.ok(!selected.some((candidate) => candidate.symbol === 'H'));
  assert.ok(selected.some((candidate) => candidate.symbol === 'G'));
  assert.equal(selected.find((candidate) => candidate.symbol === 'X').selectionReason, 'challenger-margin');
  assert.deepEqual(selected.map((candidate) => candidate.modelImportanceRank), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('hard exits and incumbents outside target x 1.25 buffer are replaced despite a zero turnover cap', () => {
  const hardExitSelection = selectMonthlyConsensusCandidates({
    candidates: [
      { symbol: 'A', consensusScore: 90 },
      { symbol: 'B', consensusScore: 85 },
      { symbol: 'C', consensusScore: 80 },
      { symbol: 'D', consensusScore: 75 },
      { symbol: 'X', consensusScore: 70 },
    ],
    targetCount: 4,
    previousPortfolio: { holdings: [{ ticker: 'A' }, { ticker: 'B', hardExit: true }, { ticker: 'C' }, { ticker: 'D' }] },
    maxNormalTurnover: 0,
  });
  assert.deepEqual(hardExitSelection.map((candidate) => candidate.symbol), ['A', 'C', 'D', 'X']);
  assert.equal(hardExitSelection.at(-1).selectionReason, 'forced-exit-replacement');

  const bufferSelection = selectMonthlyConsensusCandidates({
    candidates: [
      { symbol: 'A', consensusScore: 90 },
      { symbol: 'X', consensusScore: 89 },
      { symbol: 'Y', consensusScore: 88 },
      { symbol: 'B', consensusScore: 87 },
      { symbol: 'C', consensusScore: 86 },
      { symbol: 'D', consensusScore: 85 },
    ],
    targetCount: 4,
    previousPortfolio: { holdings: ['A', 'B', 'C', 'D'].map((ticker) => ({ ticker })) },
    maxNormalTurnover: 0,
  });
  assert.ok(!bufferSelection.some((candidate) => candidate.symbol === 'D'));
  assert.ok(bufferSelection.some((candidate) => candidate.symbol === 'X'));
});

test('one-call API returns deterministic alphabetical importance order on exact ties', () => {
  const result = buildMonthlyConsensusSelection({
    profile: { ...profile, targetCount: 2 },
    currentCandidates: [live('ZZZ', 70), live('AAA', 70), live('MMM', 70)],
    observations: [],
    asOf: '2026-01-31T00:00:00.000Z',
    scoreCandidate: (candidate) => candidate.liveScore,
    isCurrentEligible: (candidate) => candidate.eligible,
  });

  assert.deepEqual(result.rankedCandidates.map((candidate) => candidate.symbol), ['AAA', 'MMM', 'ZZZ']);
  assert.deepEqual(result.selectedCandidates.map((candidate) => candidate.symbol), ['AAA', 'MMM']);
  assert.deepEqual(result.selectedCandidates.map((candidate) => candidate.modelImportanceRank), [1, 2]);
  assert.equal(MODEL_PORTFOLIO_CONSENSUS_DEFAULTS.weights.recencyWeighted, 0.5);
});

test('aynı ekrandaki kod farklı piyasalarda ayrı analiz serileri olarak kalır', () => {
  const result = buildMonthlyConsensusSelection({
    profile: { ...profile, targetCount: 2 },
    currentCandidates: [
      live('ABC', 80, { market: 'BIST', sourceSymbol: 'ABC.IS' }),
      live('ABC', 70, { id: 'ABC-US-long', market: 'NASDAQ', sourceSymbol: 'ABC' }),
    ],
    observations: [
      observation('ABC', 100, '2026-01-30T00:00:00.000Z', 90, true, {
        source_symbol: 'ABC.IS',
        market: 'BIST',
      }),
      observation('ABC', 100, '2026-01-30T00:00:00.000Z', 60, true, {
        source_symbol: 'ABC',
        market: 'NASDAQ',
      }),
    ],
    asOf: '2026-01-31T00:00:00.000Z',
    scoreCandidate: (candidate) => candidate.liveScore,
    isCurrentEligible: (candidate) => candidate.eligible,
  });

  assert.equal(result.rankedCandidates.length, 2);
  assert.equal(result.selectedCandidates.length, 2);
  assert.deepEqual(
    result.selectedCandidates.map((candidate) => candidate.sourceSymbol),
    ['ABC.IS', 'ABC']
  );
  assert.ok(result.selectedCandidates.every((candidate) => candidate.symbol === 'ABC'));
});

test('sektör kotası challenger marjını veya taşıma sınırını dolanamaz', () => {
  const selected = selectMonthlyConsensusCandidates({
    candidates: [
      { symbol: 'C', sector: 'Teknoloji', consensusScore: 94 },
      { symbol: 'A', sector: 'Teknoloji', consensusScore: 90 },
      { symbol: 'D', sector: 'Sanayi', consensusScore: 86 },
      { symbol: 'B', sector: 'Finans', consensusScore: 80 },
    ],
    targetCount: 2,
    previousPortfolio: {
      holdings: [
        { ticker: 'A', sector: 'Teknoloji' },
        { ticker: 'B', sector: 'Finans' },
      ],
    },
    maxNormalTurnover: 1,
    challengerMargin: 5,
    carryoverRankMultiplier: 2,
    selectionGroup: (candidate) => candidate.sector,
    maxPerGroup: 1,
  });

  // C daha yüksek skorlu olsa da A'yı değiştirmek için gereken 5 puanı
  // bulamaz ve aynı sektördeyken B'nin yerine de giremez; D gerekli marjı geçer.
  assert.deepEqual(selected.map((candidate) => candidate.symbol), ['A', 'D']);
  assert.equal(selected.find((candidate) => candidate.symbol === 'D')?.selectionReason, 'challenger-margin');

  const initial = selectMonthlyConsensusCandidates({
    candidates: [
      { symbol: 'A', sector: 'Teknoloji', consensusScore: 90 },
      { symbol: 'C', sector: 'Teknoloji', consensusScore: 89 },
      { symbol: 'B', sector: 'Finans', consensusScore: 80 },
    ],
    targetCount: 2,
    selectionGroup: (candidate) => candidate.sector,
    maxPerGroup: 1,
  });
  assert.deepEqual(initial.map((candidate) => candidate.symbol), ['A', 'B']);
});

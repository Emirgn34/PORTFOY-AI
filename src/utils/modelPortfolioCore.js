import { scoreAndRankCandidates } from './opportunityScoringCore.js';
import { buildEntryPlan } from './priceLevels.js';
import { getThemeTags } from './researchInsights.js';
import { buildMonthlyConsensusSelection } from './modelPortfolioConsensus.js';

export const MODEL_PORTFOLIO_PROFILES = [
  {
    slug: 'quality-defense',
    name: 'Koruma & Kalite',
    shortName: 'Koruma',
    description: 'Düşük oynaklık, güçlü bilanço ve likidite odaklı çekirdek sepet.',
    riskTier: 1,
    riskLabel: 'Düşük',
    horizon: 'long',
    targetCount: 8,
    minimumCount: 4,
    cashReservePct: 10,
    maxPositionPct: 14,
    maxPerSector: 2,
    sleeveLimitPct: null,
  },
  {
    slug: 'balanced-growth',
    name: 'Dengeli Büyüme',
    shortName: 'Büyüme',
    description: 'Temel sağlamlık ile satış/kâr büyümesini dengeler; sektör yoğunlaşmasını sınırlar.',
    riskTier: 2,
    riskLabel: 'Orta',
    horizon: 'long',
    targetCount: 10,
    minimumCount: 5,
    cashReservePct: 8,
    maxPositionPct: 12,
    maxPerSector: 3,
    sleeveLimitPct: null,
  },
  {
    slug: 'technology-growth',
    name: 'Teknoloji & Temalar',
    shortName: 'Teknoloji',
    description: 'Yapay zekâ altyapısı, yarı iletken ve teknoloji büyümesine odaklı tematik uydu sepet.',
    riskTier: 3,
    riskLabel: 'Orta-Yüksek',
    horizon: 'long',
    targetCount: 8,
    minimumCount: 3,
    cashReservePct: 10,
    maxPositionPct: 15,
    maxPerSector: 5,
    sleeveLimitPct: 30,
  },
  {
    slug: 'short-momentum',
    name: 'Kısa Vadeli Momentum',
    shortName: 'Momentum',
    description: 'Hacim, teknik momentum, somut olay ve işlem maliyeti sonrası avantaj arayan yüksek riskli uydu sepet.',
    riskTier: 4,
    riskLabel: 'Yüksek',
    horizon: 'short',
    targetCount: 6,
    minimumCount: 3,
    cashReservePct: 15,
    maxPositionPct: 16,
    maxPerSector: 2,
    sleeveLimitPct: 20,
  },
];

export const MODEL_PORTFOLIO_TERM_MONTHS = 1;
export const MODEL_PORTFOLIO_DATA_FRESH_HOURS = 6;

/**
 * Takvim ayı eklerken ay sonunu güvenli biçimde sıkıştırır.
 * Örn. 31 Ocak + 1 ay = 28/29 Şubat; saat ve UTC dakikası korunur.
 */
export function addUtcMonths(iso, months = MODEL_PORTFOLIO_TERM_MONTHS) {
  const source = new Date(iso);
  if (!Number.isFinite(source.getTime())) return null;
  const result = new Date(source);
  const wantedDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
  ).getUTCDate();
  result.setUTCDate(Math.min(wantedDay, lastDay));
  return result.toISOString();
}

const riskValue = { Düşük: 24, Orta: 52, Yüksek: 82 };
const value = (candidate, key) => Number(candidate?.scoreBreakdown?.[key] ?? 0);

export function isUsEquity(candidate) {
  return ['NASDAQ', 'NYSE', 'AMEX', 'NYSEARCA', 'NYSEAMERICAN', 'ABD', 'US'].includes(String(candidate?.market ?? '').toUpperCase())
    && (!candidate?.quoteType || candidate.quoteType === 'EQUITY')
    && !candidateSourceSymbol(candidate).endsWith('.IS');
}

export function isModelPortfolioCandidateEligible(candidate, profile) {
  if (!isUsEquity(candidate)) return false;
  if (!candidate || !candidate.currentPrice || !candidate.priceStructure) return false;
  if (candidate.analysisDepth && candidate.analysisDepth !== 'deep') return false;
  if (candidate.liquidityLevel === 'Düşük' && profile.riskTier <= 3) return false;
  if (profile.slug === 'quality-defense') {
    return (
      candidate.riskLevel === 'Düşük' &&
      value(candidate, 'fundamentalHealthScore') >= 55 &&
      value(candidate, 'riskAdjustedScore') >= 60
    );
  }
  if (profile.slug === 'balanced-growth') {
    return (
      candidate.riskLevel !== 'Yüksek' &&
      value(candidate, 'fundamentalHealthScore') >= 50 &&
      value(candidate, 'growthScore') >= 50
    );
  }
  if (profile.slug === 'technology-growth') {
    const tags = getThemeTags(candidate);
    return (
      (tags.includes('ai-infrastructure') || tags.includes('semiconductors')) &&
      value(candidate, 'growthScore') >= 48
    );
  }
  if (profile.slug === 'short-momentum') {
    return (
      candidate.expectation?.hasActionableEdge === true &&
      value(candidate, 'technicalMomentumScore') >= 55 &&
      value(candidate, 'volumeConfirmationScore') >= 50 &&
      (candidate.conviction?.evidence?.length ?? 0) > 0 &&
      (candidate.conviction?.score ?? 0) >= 45
    );
  }
  return false;
}

export function getModelPortfolioProfileScore(candidate, profile) {
  if (profile.slug === 'quality-defense') {
    return (
      value(candidate, 'fundamentalHealthScore') * 0.3 +
      value(candidate, 'valuationScore') * 0.22 +
      value(candidate, 'dividendScore') * 0.18 +
      value(candidate, 'riskAdjustedScore') * 0.2 +
      candidate.shortTermScore * 0.1
    );
  }
  if (profile.slug === 'balanced-growth') {
    return (
      value(candidate, 'fundamentalHealthScore') * 0.25 +
      value(candidate, 'growthScore') * 0.35 +
      value(candidate, 'valuationScore') * 0.15 +
      value(candidate, 'riskAdjustedScore') * 0.1 +
      candidate.shortTermScore * 0.15
    );
  }
  if (profile.slug === 'technology-growth') {
    return (
      value(candidate, 'growthScore') * 0.4 +
      value(candidate, 'fundamentalHealthScore') * 0.15 +
      (candidate.expectation?.expectedReturnPct ?? 0) * 1.2 +
      candidate.shortTermScore * 0.3
    );
  }
  return (
    value(candidate, 'technicalMomentumScore') * 0.28 +
    value(candidate, 'volumeConfirmationScore') * 0.22 +
    value(candidate, 'newsCatalystScore') * 0.16 +
    (candidate.conviction?.score ?? 0) * 0.2 +
    candidate.shortTermScore * 0.14
  );
}

function selectDiversified(ranked, profile) {
  const chosen = [];
  const sectors = new Map();
  for (const candidate of ranked) {
    if (chosen.length >= profile.targetCount) break;
    const sector = candidate.sector ?? 'Diğer';
    const count = sectors.get(sector) ?? 0;
    if (count >= profile.maxPerSector) continue;
    chosen.push(candidate);
    sectors.set(sector, count + 1);
  }
  return chosen;
}

function candidateSourceSymbol(candidate) {
  const displaySymbol = String(candidate?.symbol ?? candidate?.ticker ?? '').trim().toUpperCase();
  return String(
    candidate?.sourceSymbol ??
      candidate?.source_symbol ??
      candidate?.provenance?.sourceSymbol ??
      (candidate?.market === 'BIST' && displaySymbol && !displaySymbol.endsWith('.IS')
        ? `${displaySymbol}.IS`
        : displaySymbol)
  ).trim().toUpperCase();
}

function previousPortfolioFor(previousPortfolios, slug) {
  if (!Array.isArray(previousPortfolios)) return null;
  const match = previousPortfolios.find(
    (portfolio) => (portfolio?.slug ?? portfolio?.data?.slug) === slug
  );
  return match?.data ?? match ?? null;
}

function selectProfileCandidates(
  ranked,
  profile,
  { generatedAt, analysisHistory = null, previousPortfolio = null }
) {
  if (!Array.isArray(analysisHistory) || analysisHistory.length === 0) {
    return {
      selected: selectDiversified(ranked, profile).map((candidate, index) => ({
        ...candidate,
        modelImportanceRank: index + 1,
        selectionReason: 'latest-generation-rank',
      })),
      selectionMethod: 'latest-generation-v1',
    };
  }

  const { selectedCandidates } = buildMonthlyConsensusSelection({
    profile,
    horizon: profile.horizon,
    currentCandidates: ranked,
    observations: analysisHistory,
    previousPortfolio,
    asOf: generatedAt,
    scoreCandidate: (candidate) => candidate.modelRankScore,
    isCurrentEligible: () => true,
    selectionGroup: (candidate) => candidate.sector ?? 'Diğer',
    maxPerGroup: profile.maxPerSector,
  });

  return {
    selected: selectedCandidates,
    selectionMethod: 'rolling-30d-consensus-v1',
  };
}

function rationaleFor(candidate, profile) {
  const reasons = [];
  if (profile.horizon === 'long') {
    reasons.push(
      `Temel ${Math.round(value(candidate, 'fundamentalHealthScore'))}/100, büyüme ${Math.round(value(candidate, 'growthScore'))}/100.`
    );
  } else {
    reasons.push(
      `Momentum ${Math.round(value(candidate, 'technicalMomentumScore'))}/100, hacim ${Math.round(value(candidate, 'volumeConfirmationScore'))}/100.`
    );
  }
  if (candidate.conviction?.evidence?.[0]?.text) reasons.push(candidate.conviction.evidence[0].text);
  else if (candidate.reasonShort) reasons.push(candidate.reasonShort);
  return reasons.slice(0, 2);
}

function buildHolding(candidate, profile, weightPct, sourceGeneration, modelImportanceRank) {
  const entryPlan = buildEntryPlan(candidate.priceStructure, candidate.currentPrice);
  if (!entryPlan) return null;
  const displaySymbol = String(candidate.symbol ?? '').trim().toUpperCase();
  const sourceSymbol = candidateSourceSymbol(candidate);
  return {
    ticker: displaySymbol,
    sourceSymbol,
    companyName: candidate.companyName,
    market: candidate.market,
    sector: candidate.sector,
    industry: candidate.industry ?? null,
    currency: candidate.currency,
    weightPct,
    currentPriceAtGeneration: candidate.currentPrice,
    entryPlan: { ...entryPlan, methodVersion: 'support-buffer-v1' },
    target: {
      price: candidate.expectation?.expectedPrice ?? candidate.analystTarget?.targetMean ?? null,
      expectedReturnPct: candidate.expectation?.expectedReturnPct ?? null,
      horizonLabel: candidate.expectation?.horizonLabel ?? candidate.estimatedHorizon ?? null,
      confidenceLabel: candidate.expectation?.confidenceLabel ?? null,
    },
    opportunityScore: candidate.shortTermScore,
    convictionScore: candidate.conviction?.score ?? null,
    valuation: candidate.valuation ?? null,
    riskLevel: candidate.riskLevel,
    liquidityLevel: candidate.liquidityLevel,
    modelImportanceRank,
    modelImportanceScore: Number.isFinite(
      Number(candidate.consensusScore ?? candidate.modelRankScore)
    )
      ? Number(Number(candidate.consensusScore ?? candidate.modelRankScore).toFixed(2))
      : null,
    consensusScore: Number.isFinite(Number(candidate.consensusScore))
      ? Number(Number(candidate.consensusScore).toFixed(2))
      : null,
    carriedFromPrevious: Boolean(candidate.carriedFromPrevious),
    selectionReason: candidate.selectionReason ?? 'profile-rank',
    rationale: rationaleFor(candidate, profile),
    risks: candidate.riskWarnings?.slice?.(0, 2) ?? [],
    provenance: {
      candidateId: candidate.id,
      sourceSymbol,
      horizon: profile.horizon,
      sourceGeneration,
    },
  };
}

function portfolioFor(
  profile,
  allCandidates,
  {
    generatedAt,
    sourceGeneration,
    cycleStart = generatedAt,
    cycleEnd = addUtcMonths(cycleStart),
    tracking = null,
    analysisHistory = null,
    previousPortfolio = null,
    valueFocus = false,
  }
) {
  const profileAnalysisHistory = Array.isArray(analysisHistory)
    ? analysisHistory.filter(
        (observation) => !observation?.horizon || observation.horizon === profile.horizon
      )
    : null;
  const ranked = scoreAndRankCandidates(allCandidates, profile.horizon, generatedAt)
    .filter((candidate) => isModelPortfolioCandidateEligible(candidate, profile))
    .filter((candidate) => !valueFocus || candidate.valuation?.eligible === true)
    .map((candidate) => ({
      ...candidate,
      horizon: candidate.horizon ?? profile.horizon,
      generation: candidate.generation ?? sourceGeneration,
      capturedAt: candidate.capturedAt ?? generatedAt,
      modelRankScore: getModelPortfolioProfileScore(candidate, profile) * (valueFocus ? 0.75 : 1)
        + (valueFocus ? candidate.valuation.score * 0.25 : 0),
    }))
    .sort((a, b) => b.modelRankScore - a.modelRankScore || a.symbol.localeCompare(b.symbol));
  const { selected, selectionMethod } = selectProfileCandidates(ranked, profile, {
    generatedAt,
    analysisHistory: profileAnalysisHistory,
    previousPortfolio,
  });
  const investable = 100 - profile.cashReservePct;
  const rawWeight = selected.length ? investable / selected.length : 0;
  const weight = Number(Math.min(profile.maxPositionPct, rawWeight).toFixed(1));
  const holdings = selected
    .map((candidate, index) =>
      buildHolding(candidate, profile, weight, sourceGeneration, index + 1)
    )
    .filter(Boolean);
  const invested = Number(holdings.reduce((sum, holding) => sum + holding.weightPct, 0).toFixed(1));
  const cashWeightPct = Number(Math.max(0, 100 - invested).toFixed(1));
  const weightedRisk = holdings.length
    ? holdings.reduce((sum, holding) => sum + (riskValue[holding.riskLevel] ?? 55), 0) / holdings.length
    : profile.riskTier * 20;
  const riskScore = Math.round(
    Math.min(100, Math.max(0, weightedRisk * (1 - cashWeightPct / 180) + (profile.riskTier - 1) * 6))
  );
  const average = (selector) => {
    const values = holdings
      .map(selector)
      .filter((item) => item != null && Number.isFinite(Number(item)))
      .map(Number);
    return values.length
      ? Number((values.reduce((sum, item) => sum + item, 0) / values.length).toFixed(1))
      : null;
  };
  const holdingsWithExpectation = holdings.filter((holding) =>
    holding.target.expectedReturnPct != null &&
    Number.isFinite(Number(holding.target.expectedReturnPct))
  );
  const expectedReturnCoveragePct = Number(
    holdingsWithExpectation.reduce((sum, holding) => sum + holding.weightPct, 0).toFixed(1)
  );
  // Portföy getirisi, hisse tahminlerinin sepet ağırlıklarıyla katkısıdır. Nakit
  // için %0 varsayılır; herhangi bir yatırım kaleminin beklentisi eksikse tek bir
  // “portföy getirisi” yayımlamak yerine alan boş bırakılır.
  const portfolioExpectedReturnPct =
    holdings.length > 0 && holdingsWithExpectation.length === holdings.length
      ? Number(
          holdings
            .reduce(
              (sum, holding) =>
                sum + Number(holding.target.expectedReturnPct) * (holding.weightPct / 100),
              0
            )
            .toFixed(1)
        )
      : null;
  const warnings = [];
  if (holdings.length < profile.minimumCount) {
    warnings.push(
      `Kalite eşiğini yalnızca ${holdings.length} hisse geçti; zayıf aday eklemek yerine nakit oranı yükseltildi.`
    );
  }
  if (profile.sleeveLimitPct) {
    warnings.push(`Bu sepet toplam yatırım sermayesinin en fazla %${profile.sleeveLimitPct}'lik uydu bölümü için tasarlanmıştır.`);
  }
  return {
    schemaVersion: 3,
    marketScope: 'US',
    valueFocus,
    methodologyVersion: 'model-portfolio-v3-consensus',
    versionKey: `${profile.slug}--${cycleStart}`,
    slug: profile.slug,
    name: profile.name,
    shortName: profile.shortName,
    description: profile.description,
    riskTier: profile.riskTier,
    riskLabel: profile.riskLabel,
    riskScore,
    horizon: profile.horizon,
    sourceGeneration,
    generatedAt,
    cycleStart,
    cycleEnd,
    termMonths: MODEL_PORTFOLIO_TERM_MONTHS,
    rebalanceFrequency: 'monthly',
    cycleStatus: 'active',
    dataFreshUntil: new Date(
      new Date(generatedAt).getTime() + MODEL_PORTFOLIO_DATA_FRESH_HOURS * 60 * 60 * 1000
    ).toISOString(),
    // Geriye dönük uyumluluk: validUntil giriş planının/verinin tazeliğidir;
    // portföy vadesi cycleEnd ile ayrıca izlenir.
    validUntil: new Date(
      new Date(generatedAt).getTime() + MODEL_PORTFOLIO_DATA_FRESH_HOURS * 60 * 60 * 1000
    ).toISOString(),
    refreshIntervalHours: MODEL_PORTFOLIO_DATA_FRESH_HOURS,
    tracking,
    selection: {
      method: selectionMethod,
      analysisWindowDays: selectionMethod === 'rolling-30d-consensus-v1' ? 30 : null,
      observationCount: profileAnalysisHistory?.length ?? 0,
      generationCount: profileAnalysisHistory
        ? new Set(
          profileAnalysisHistory.map(
              (observation) => observation.generation ?? observation.source_generation
            ).filter((generation) => generation != null)
          ).size
        : 0,
      carriedHoldingCount: holdings.filter((holding) => holding.carriedFromPrevious).length,
    },
    sleeveLimitPct: profile.sleeveLimitPct,
    cashWeightPct,
    metrics: {
      opportunityScore: average((holding) => holding.opportunityScore),
      convictionScore: average((holding) => holding.convictionScore),
      expectedReturnPct: portfolioExpectedReturnPct,
      expectedReturnCoveragePct,
    },
    warnings,
    holdings,
  };
}

export function buildModelPortfolios({
  shortCandidates = [],
  longCandidates = [],
  generatedAt = new Date().toISOString(),
  sourceGeneration = Date.parse(generatedAt),
  cycleStart = generatedAt,
  cycleEnd = addUtcMonths(cycleStart),
  tracking = null,
  analysisHistory = null,
  previousPortfolios = null,
  valueFocus = false,
} = {}) {
  return MODEL_PORTFOLIO_PROFILES.map((profile) =>
    portfolioFor(profile, profile.horizon === 'short' ? shortCandidates : longCandidates, {
      generatedAt,
      sourceGeneration,
      cycleStart,
      cycleEnd,
      tracking,
      analysisHistory,
      previousPortfolio: previousPortfolioFor(previousPortfolios, profile.slug),
      valueFocus,
    })
  );
}

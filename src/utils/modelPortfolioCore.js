import { scoreAndRankCandidates } from './opportunityScoringCore.js';
import { buildEntryPlan } from './priceLevels.js';
import { getThemeTags } from './researchInsights.js';

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

const riskValue = { Düşük: 24, Orta: 52, Yüksek: 82 };
const value = (candidate, key) => Number(candidate?.scoreBreakdown?.[key] ?? 0);

function eligible(candidate, profile) {
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

function profileRank(candidate, profile) {
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

function buildHolding(candidate, profile, weightPct, sourceGeneration) {
  const entryPlan = buildEntryPlan(candidate.priceStructure, candidate.currentPrice);
  if (!entryPlan) return null;
  return {
    ticker: candidate.symbol,
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
    riskLevel: candidate.riskLevel,
    liquidityLevel: candidate.liquidityLevel,
    rationale: rationaleFor(candidate, profile),
    risks: candidate.riskWarnings?.slice?.(0, 2) ?? [],
    provenance: {
      candidateId: candidate.id,
      horizon: profile.horizon,
      sourceGeneration,
    },
  };
}

function portfolioFor(profile, allCandidates, { generatedAt, sourceGeneration }) {
  const ranked = scoreAndRankCandidates(allCandidates, profile.horizon, generatedAt)
    .filter((candidate) => eligible(candidate, profile))
    .map((candidate) => ({ ...candidate, modelRankScore: profileRank(candidate, profile) }))
    .sort((a, b) => b.modelRankScore - a.modelRankScore || a.symbol.localeCompare(b.symbol));
  const selected = selectDiversified(ranked, profile);
  const investable = 100 - profile.cashReservePct;
  const rawWeight = selected.length ? investable / selected.length : 0;
  const weight = Number(Math.min(profile.maxPositionPct, rawWeight).toFixed(1));
  const holdings = selected
    .map((candidate) => buildHolding(candidate, profile, weight, sourceGeneration))
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
    schemaVersion: 1,
    methodologyVersion: 'model-portfolio-v1',
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
    validUntil: new Date(new Date(generatedAt).getTime() + 6 * 60 * 60 * 1000).toISOString(),
    refreshIntervalHours: 6,
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
} = {}) {
  return MODEL_PORTFOLIO_PROFILES.map((profile) =>
    portfolioFor(profile, profile.horizon === 'short' ? shortCandidates : longCandidates, {
      generatedAt,
      sourceGeneration,
    })
  );
}

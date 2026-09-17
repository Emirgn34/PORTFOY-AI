/**
 * Pure monthly model-portfolio consensus helpers.
 *
 * The module deliberately does not import modelPortfolioCore: callers pass the
 * current eligibility/profile-scoring rules so the monthly engine cannot drift
 * from the rules used by the live candidate pipeline.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const MODEL_PORTFOLIO_CONSENSUS_DEFAULTS = Object.freeze({
  windowDays: 30,
  halfLifeDays: 7,
  minimumGenerations: 20,
  minimumSpanDays: 7,
  persistenceThreshold: 50,
  challengerMargin: 5,
  carryoverRankMultiplier: 1.25,
  normalTurnoverRate: 0.3,
  weights: Object.freeze({
    recencyWeighted: 0.5,
    median: 0.25,
    persistence: 0.15,
    latest: 0.1,
  }),
});

/**
 * Aylık resmi sepetin tek bir 6 saatlik fotoğraftan üretilmesini engeller.
 * Her vade, yeterli sayıda ayrı tarama ve takvim yayılımına sahip olmalıdır.
 */
export function assessMonthlyConsensusCoverage(observations = [], options = {}) {
  const horizons = Array.isArray(options.horizons) && options.horizons.length
    ? options.horizons.map(normalizeHorizon).filter(Boolean)
    : ['short', 'long'];
  const minimumGenerations = Math.max(
    1,
    Math.floor(
      positiveNumber(
        options.minimumGenerations,
        MODEL_PORTFOLIO_CONSENSUS_DEFAULTS.minimumGenerations
      )
    )
  );
  const minimumSpanDays = nonNegativeNumber(
    options.minimumSpanDays,
    MODEL_PORTFOLIO_CONSENSUS_DEFAULTS.minimumSpanDays
  );
  const rows = Array.isArray(observations) ? observations : [];
  const results = horizons.map((horizon) => {
    const episodeTimes = new Map();
    for (const row of rows) {
      if (normalizeHorizon(horizonOf(row)) !== horizon) continue;
      const capturedMs = timeMs(capturedAtOf(row) ?? generationOf(row));
      if (capturedMs == null) continue;
      const key = episodeKey(row, capturedMs);
      const previous = episodeTimes.get(key);
      if (previous == null || capturedMs < previous) episodeTimes.set(key, capturedMs);
    }
    const times = [...episodeTimes.values()].sort((left, right) => left - right);
    const spanDays = times.length > 1
      ? (times.at(-1) - times[0]) / DAY_MS
      : 0;
    const generationCount = times.length;
    return {
      horizon,
      generationCount,
      spanDays: round(spanDays),
      ok: generationCount >= minimumGenerations && spanDays >= minimumSpanDays,
    };
  });
  return {
    ok: results.every((result) => result.ok),
    minimumGenerations,
    minimumSpanDays,
    horizons: results,
  };
}

function own(object, key) {
  return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
}

function finiteNumber(value) {
  if (value == null || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value, fallback) {
  const parsed = finiteNumber(value);
  return parsed != null && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value, fallback) {
  const parsed = finiteNumber(value);
  return parsed != null && parsed >= 0 ? parsed : fallback;
}

function clampScore(value) {
  const parsed = finiteNumber(value);
  return parsed == null ? null : Math.min(100, Math.max(0, parsed));
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeSymbol(value) {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeHorizon(value) {
  return String(value ?? '').trim().toLowerCase();
}

function timeMs(value) {
  if (value instanceof Date) {
    const parsed = value.getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // Generation values are normally epoch milliseconds, but accepting epoch
    // seconds makes imported observation files less surprising.
    const parsed = value > 0 && value < 100_000_000_000 ? value * 1000 : value;
    return Number.isFinite(new Date(parsed).getTime()) ? parsed : null;
  }
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoTime(value) {
  const parsed = timeMs(value);
  return parsed == null ? null : new Date(parsed).toISOString();
}

function symbolOf(value) {
  return normalizeSymbol(
    value?.symbol ?? value?.ticker ?? value?.data?.symbol ?? value?.data?.ticker
  );
}

function identityOf(value) {
  const explicit = normalizeSymbol(
    value?.sourceSymbol ??
      value?.source_symbol ??
      value?.provenance?.sourceSymbol ??
      value?.provenance?.source_symbol ??
      value?.data?.sourceSymbol ??
      value?.data?.source_symbol ??
      value?.data?.provenance?.sourceSymbol ??
      value?.data?.provenance?.source_symbol
  );
  if (explicit) return explicit;
  const symbol = symbolOf(value);
  const market = normalizeSymbol(value?.market ?? value?.data?.market);
  return market === 'BIST' && symbol && !symbol.endsWith('.IS') ? `${symbol}.IS` : symbol;
}

function horizonOf(value) {
  return normalizeHorizon(value?.horizon ?? value?.data?.horizon);
}

function generationOf(value) {
  return value?.generation ?? value?.sourceGeneration ?? value?.source_generation ?? null;
}

function capturedAtOf(value) {
  return (
    value?.capturedAt ??
    value?.captured_at ??
    value?.updatedAt ??
    value?.updated_at ??
    value?.generatedAt ??
    value?.generated_at ??
    null
  );
}

function objectScores(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    const score = clampScore(raw);
    if (score != null) result[key] = score;
  }
  return result;
}

function objectBooleans(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'boolean') result[key] = raw;
  }
  return result;
}

function genericProfileValue(source, profile) {
  if (!source || typeof source !== 'object') return null;
  const slug = String(profile?.slug ?? '').trim();
  const scoreKey = String(profile?.scoreKey ?? '').trim();
  const maps = [
    source.profileScores,
    source.profile_scores,
    source.modelProfileScores,
    source.model_profile_scores,
  ];
  for (const map of maps) {
    if (!map || typeof map !== 'object') continue;
    if (slug && own(map, slug)) return clampScore(map[slug]);
    if (scoreKey && own(map, scoreKey)) return clampScore(map[scoreKey]);
  }

  for (const key of [scoreKey, 'profileScore', 'profile_score', 'modelRankScore', 'score']) {
    if (key && own(source, key)) {
      const score = clampScore(source[key]);
      if (score != null) return score;
    }
  }

  if (source.data && source.data !== source) {
    return genericProfileValue(source.data, profile);
  }
  return null;
}

function genericEligibility(source, profile) {
  if (!source || typeof source !== 'object') return null;
  const slug = String(profile?.slug ?? '').trim();
  const maps = [
    source.eligibility,
    source.profileEligibility,
    source.profile_eligibility,
    source.eligibilityByProfile,
    source.eligibility_by_profile,
  ];
  for (const map of maps) {
    if (slug && map && typeof map === 'object' && typeof map[slug] === 'boolean') {
      return map[slug];
    }
  }

  if (Array.isArray(source.eligibleProfiles) && slug) {
    return source.eligibleProfiles.includes(slug);
  }
  if (Array.isArray(source.ineligibleProfiles) && slug && source.ineligibleProfiles.includes(slug)) {
    return false;
  }
  for (const key of ['eligible', 'isEligible', 'profileEligible']) {
    if (typeof source[key] === 'boolean') return source[key];
  }
  if (source.data && source.data !== source) return genericEligibility(source.data, profile);
  return null;
}

function callbackValue(callback, source, profile, context) {
  if (typeof callback !== 'function') return { called: false, value: undefined };
  try {
    return { called: true, value: callback(source, profile, context) };
  } catch {
    return { called: true, value: undefined };
  }
}

function profileScore(source, profile, callback, context) {
  const custom = callbackValue(callback, source, profile, context);
  if (custom.called) return clampScore(custom.value);
  return genericProfileValue(source, profile);
}

function currentEligibility(candidate, profile, callback) {
  const custom = callbackValue(callback, candidate, profile, { kind: 'current' });
  if (custom.called) return custom.value === true;
  return genericEligibility(candidate, profile) !== false;
}

function observationEligibility(observation, profile, callback, score, threshold) {
  const custom = callbackValue(callback, observation, profile, {
    kind: 'observation',
    score,
  });
  if (custom.called && typeof custom.value === 'boolean') return custom.value;
  const generic = genericEligibility(observation, profile);
  if (typeof generic === 'boolean') return generic;
  return score >= threshold;
}

function expectedReturnOf(candidate) {
  return finiteNumber(
    candidate?.expectedReturn ??
      candidate?.expectedReturnPct ??
      candidate?.expected_return ??
      candidate?.expectation?.expectedReturnPct ??
      candidate?.target?.expectedReturnPct
  );
}

function convictionOf(candidate) {
  const value = candidate?.conviction;
  if (value && typeof value === 'object') {
    return clampScore(value.score ?? value.finalScore ?? value.ruleScore);
  }
  return clampScore(candidate?.convictionScore ?? candidate?.conviction_score ?? value);
}

/**
 * Convert a live candidate into the small, append-only shape needed by the
 * monthly engine. `profileScores` should be calculated with the same profile
 * scorer used by the live portfolio builder.
 */
export function compactModelPortfolioObservation(candidate, options = {}) {
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  const symbol = normalizeSymbol(options.symbol ?? symbolOf(source));
  if (!symbol) return null;
  const sourceSymbol = normalizeSymbol(
    options.sourceSymbol ?? options.source_symbol ?? identityOf(source)
  );

  const capturedAt = isoTime(
    options.capturedAt ?? capturedAtOf(source) ?? generationOf(source)
  );
  const factorScores = objectScores(
    options.factorScores ??
      source.factorScores ??
      source.factor_scores ??
      source.scoreBreakdown ??
      source.score_breakdown
  );
  const profileScores = objectScores(
    options.profileScores ?? source.profileScores ?? source.profile_scores
  );
  const fallbackScore =
    options.score ?? source.score ?? source.profileScore ?? source.shortTermScore;
  const risk =
    options.risk ?? source.risk ?? source.riskLevel ?? source.risk_level ?? null;
  const liquidity =
    options.liquidity ??
    source.liquidity ??
    source.liquidityLevel ??
    source.liquidity_level ??
    null;
  const hasDataOption = own(options, 'data');

  return {
    sourceSymbol: sourceSymbol || symbol,
    symbol,
    horizon: normalizeHorizon(options.horizon ?? horizonOf(source)) || null,
    capturedAt,
    generation: options.generation ?? generationOf(source),
    score: clampScore(fallbackScore),
    profileScores,
    factorScores,
    profileEligibility: objectBooleans(
      options.profileEligibility ?? source.profileEligibility ?? source.profile_eligibility
    ),
    risk,
    liquidity,
    expectedReturn: expectedReturnOf({
      ...source,
      ...(own(options, 'expectedReturn') ? { expectedReturn: options.expectedReturn } : {}),
    }),
    conviction: convictionOf({ ...source, conviction: options.conviction ?? source.conviction }),
    data: hasDataOption ? options.data : source.data ?? null,
  };
}

/** Batch form of compactModelPortfolioObservation. Invalid rows are omitted. */
export function compactModelPortfolioObservations(candidates, options = {}) {
  if (!Array.isArray(candidates)) return [];
  return candidates
    .map((candidate, index) => {
      const rowOptions =
        typeof options === 'function' ? options(candidate, index) ?? {} : options;
      return compactModelPortfolioObservation(candidate, rowOptions);
    })
    .filter(Boolean);
}

function resolveAsOf(explicit, currentCandidates, observations) {
  const requested = timeMs(explicit);
  if (requested != null) return requested;

  let latest = null;
  for (const item of [...currentCandidates, ...observations]) {
    const parsed = timeMs(capturedAtOf(item) ?? generationOf(item));
    if (parsed != null && (latest == null || parsed > latest)) latest = parsed;
  }
  // Epoch is intentionally deterministic. Production callers normally pass
  // generatedAt; tests/offline imports can also derive it from their rows.
  return latest ?? 0;
}

function episodeKey(observation, capturedMs) {
  const generation = generationOf(observation);
  if (generation != null && String(generation).trim() !== '') return `g:${String(generation)}`;
  return `t:${new Date(capturedMs).toISOString()}`;
}

function compareSymbols(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareRanked(left, right) {
  return (
    right._consensusRaw - left._consensusRaw ||
    right._latestRaw - left._latestRaw ||
    compareSymbols(left._identity, right._identity)
  );
}

function preferObservation(next, current) {
  if (!current) return true;
  if (next.isCurrent !== current.isCurrent) return next.isCurrent;
  if (next.capturedMs !== current.capturedMs) return next.capturedMs > current.capturedMs;
  if (next.score !== current.score) return next.score > current.score;
  return false;
}

function median(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function candidateTieKey(candidate) {
  return [
    String(candidate?.id ?? ''),
    String(generationOf(candidate) ?? ''),
    String(capturedAtOf(candidate) ?? ''),
  ].join('|');
}

/**
 * Build profile-specific monthly consensus ranks from the current, mandatory
 * candidate set and the preceding 30 days of compact observations.
 *
 * Formula:
 *   50% recency-weighted score (7-day half-life)
 * + 25% median score
 * + 15% persistence across distinct scan episodes
 * + 10% latest/current score
 */
export function buildMonthlyConsensusCandidates(options = {}) {
  const profile = options.profile ?? {};
  const currentCandidates = Array.isArray(options.currentCandidates)
    ? options.currentCandidates.filter((item) => item && typeof item === 'object')
    : [];
  const observations = Array.isArray(options.observations)
    ? options.observations.filter((item) => item && typeof item === 'object')
    : [];
  const horizon = normalizeHorizon(options.horizon ?? profile.horizon);
  const windowDays = positiveNumber(
    options.windowDays,
    MODEL_PORTFOLIO_CONSENSUS_DEFAULTS.windowDays
  );
  const halfLifeDays = positiveNumber(
    options.halfLifeDays,
    MODEL_PORTFOLIO_CONSENSUS_DEFAULTS.halfLifeDays
  );
  const persistenceThreshold = clampScore(
    options.persistenceThreshold ??
      profile.persistenceThreshold ??
      MODEL_PORTFOLIO_CONSENSUS_DEFAULTS.persistenceThreshold
  );
  const asOfMs = resolveAsOf(options.asOf, currentCandidates, observations);
  const windowStartMs = asOfMs - windowDays * DAY_MS;
  const scoreCandidate = options.scoreCandidate ?? options.getProfileScore;
  // Historical database rows already carry their immutable `profile_scores`.
  // `getProfileScore` is therefore only a convenience alias for scoring live
  // candidates. Callers may still provide a dedicated `scoreObservation` for
  // another history format, without accidentally running the live scorer over
  // compact rows that no longer contain the full candidate payload.
  const scoreObservation = options.scoreObservation;
  const isEligible = options.isCurrentEligible ?? options.isEligible;

  // Current candidates are de-duplicated by symbol before history is joined.
  // A higher live profile score wins; remaining ties use stable identifiers.
  const currentBySymbol = new Map();
  for (const candidate of currentCandidates) {
    const identity = identityOf(candidate);
    const candidateHorizon = horizonOf(candidate);
    if (!identity || (horizon && candidateHorizon && candidateHorizon !== horizon)) continue;
    if (!currentEligibility(candidate, profile, isEligible)) continue;
    const score = profileScore(candidate, profile, scoreCandidate, {
      kind: 'current',
      asOf: new Date(asOfMs).toISOString(),
    });
    if (score == null) continue;
    const normalized = { candidate, identity, score };
    const existing = currentBySymbol.get(identity);
    if (
      !existing ||
      score > existing.score ||
      (score === existing.score && candidateTieKey(candidate) < candidateTieKey(existing.candidate))
    ) {
      currentBySymbol.set(identity, normalized);
    }
  }

  const episodeKeys = new Set();
  const observationsBySymbol = new Map();

  function addObservation(source, { isCurrent = false, forcedIdentity = '', forcedScore = null } = {}) {
    const identity = forcedIdentity || identityOf(source);
    const observationHorizon = horizonOf(source);
    if (!identity || (horizon && observationHorizon && observationHorizon !== horizon)) return;

    const capturedMs = isCurrent ? asOfMs : timeMs(capturedAtOf(source) ?? generationOf(source));
    if (
      capturedMs == null ||
      capturedMs < windowStartMs ||
      capturedMs > asOfMs
    ) {
      return;
    }

    const key = episodeKey(source, capturedMs);
    episodeKeys.add(key);
    const analysisDepth = String(
      source?.analysisDepth ?? source?.analysis_depth ?? source?.data?.analysisDepth ?? ''
    )
      .trim()
      .toLowerCase();
    // Derin veri çekimi başarısız bir tur yine persistence paydasında eksik
    // gözlem olarak sayılır; fakat eksik/light faktörleri aylık ortalama ve
    // medyanı yapay biçimde yukarı/aşağı çekemez.
    if (!isCurrent && analysisDepth && analysisDepth !== 'deep') return;
    const score =
      forcedScore != null
        ? forcedScore
        : profileScore(source, profile, scoreObservation, {
            kind: 'observation',
            asOf: new Date(asOfMs).toISOString(),
          });
    // The episode remains in the persistence denominator even when this row
    // cannot be scored. That makes missing profile data conservative.
    if (score == null) return;

    const eligible = isCurrent
      ? true
      : observationEligibility(
          source,
          profile,
          options.isObservationEligible,
          score,
          persistenceThreshold ?? MODEL_PORTFOLIO_CONSENSUS_DEFAULTS.persistenceThreshold
        );
    const normalized = {
      identity,
      score,
      eligible,
      capturedMs,
      capturedAt: new Date(capturedMs).toISOString(),
      episodeKey: key,
      isCurrent,
    };
    const byEpisode = observationsBySymbol.get(identity) ?? new Map();
    const existing = byEpisode.get(key);
    if (preferObservation(normalized, existing)) byEpisode.set(key, normalized);
    observationsBySymbol.set(identity, byEpisode);
  }

  for (const observation of observations) addObservation(observation);
  for (const { candidate, identity, score } of currentBySymbol.values()) {
    addObservation(candidate, { isCurrent: true, forcedIdentity: identity, forcedScore: score });
  }

  const totalWindowEpisodes = episodeKeys.size;
  const ranked = [];
  for (const { candidate, identity, score: currentScore } of currentBySymbol.values()) {
    const rows = [...(observationsBySymbol.get(identity)?.values() ?? [])].sort(
      (left, right) =>
        left.capturedMs - right.capturedMs ||
        Number(left.isCurrent) - Number(right.isCurrent)
    );
    if (!rows.length) continue;

    let weightedTotal = 0;
    let totalWeight = 0;
    for (const row of rows) {
      const ageDays = Math.max(0, (asOfMs - row.capturedMs) / DAY_MS);
      const weight = 2 ** (-ageDays / halfLifeDays);
      weightedTotal += row.score * weight;
      totalWeight += weight;
    }
    const recencyWeightedScore = totalWeight > 0 ? weightedTotal / totalWeight : currentScore;
    const medianScore = median(rows.map((row) => row.score)) ?? currentScore;
    const eligibleObservationCount = rows.filter((row) => row.eligible).length;
    const persistenceScore = totalWindowEpisodes
      ? (eligibleObservationCount / totalWindowEpisodes) * 100
      : 0;
    const latestScore = currentScore;
    const consensusRaw =
      recencyWeightedScore * MODEL_PORTFOLIO_CONSENSUS_DEFAULTS.weights.recencyWeighted +
      medianScore * MODEL_PORTFOLIO_CONSENSUS_DEFAULTS.weights.median +
      persistenceScore * MODEL_PORTFOLIO_CONSENSUS_DEFAULTS.weights.persistence +
      latestScore * MODEL_PORTFOLIO_CONSENSUS_DEFAULTS.weights.latest;

    ranked.push({
      ...candidate,
      consensusScore: round(consensusRaw),
      carriedFromPrevious: false,
      selectionReason: 'consensus-ranked',
      observationStats: {
        observationCount: rows.length,
        historicalObservationCount: rows.filter((row) => !row.isCurrent).length,
        eligibleObservationCount,
        totalWindowEpisodes,
        coveragePct: totalWindowEpisodes
          ? round((rows.length / totalWindowEpisodes) * 100)
          : 0,
        recencyWeightedScore: round(recencyWeightedScore),
        medianScore: round(medianScore),
        persistenceScore: round(persistenceScore),
        latestScore: round(latestScore),
        firstCapturedAt: rows[0]?.capturedAt ?? null,
        lastCapturedAt: rows.at(-1)?.capturedAt ?? null,
        windowStart: new Date(windowStartMs).toISOString(),
        windowEnd: new Date(asOfMs).toISOString(),
      },
      _consensusRaw: consensusRaw,
      _latestRaw: latestScore,
      _identity: identity,
    });
  }

  ranked.sort(compareRanked);
  return ranked.map((candidate, index) => {
    const { _consensusRaw, _latestRaw, _identity, ...publicCandidate } = candidate;
    return {
      ...publicCandidate,
      consensusRank: index + 1,
      modelImportanceRank: index + 1,
    };
  });
}

function previousHoldings(previousPortfolio) {
  if (Array.isArray(previousPortfolio)) return previousPortfolio;
  if (Array.isArray(previousPortfolio?.holdings)) return previousPortfolio.holdings;
  if (Array.isArray(previousPortfolio?.data?.holdings)) return previousPortfolio.data.holdings;
  return [];
}

function genericHardExit(holding, candidate) {
  for (const source of [holding, candidate]) {
    if (!source || typeof source !== 'object') continue;
    if (source.hardExit === true || source.hard_exit === true || source.mustExit === true) {
      return true;
    }
    const status = String(source.exitStatus ?? source.exit_status ?? source.status ?? '')
      .trim()
      .toLowerCase();
    if (status === 'hard-exit' || status === 'hard_exit' || status === 'must-exit') return true;
  }
  return false;
}

function hardExit(holding, candidate, profile, callback) {
  if (typeof callback === 'function') {
    try {
      if (callback(holding, candidate, profile) === true) return true;
    } catch {
      // A callback failure must not turn into a destructive exit by itself.
    }
  }
  return genericHardExit(holding, candidate);
}

function turnoverCap(options, profile, targetCount) {
  const explicitCount = finiteNumber(
    options.maxNormalTurnover ?? options.maxNormalTurnoverCount ?? profile?.maxNormalTurnover
  );
  if (explicitCount != null) return Math.max(0, Math.floor(explicitCount));

  const configured = finiteNumber(
    options.normalTurnoverRate ?? options.turnoverLimit ?? profile?.normalTurnoverRate
  );
  const rate = configured == null
    ? MODEL_PORTFOLIO_CONSENSUS_DEFAULTS.normalTurnoverRate
    : configured;
  if (rate > 1) return Math.max(0, Math.floor(rate));
  return Math.max(0, Math.floor(targetCount * Math.max(0, rate)));
}

function selectionSort(left, right) {
  return (
    Number(right.consensusScore ?? 0) - Number(left.consensusScore ?? 0) ||
    compareSymbols(left._identity ?? identityOf(left), right._identity ?? identityOf(right))
  );
}

/**
 * Apply monthly carryover/hysteresis to already-ranked consensus candidates.
 * Forced/ineligible/out-of-buffer exits never consume the normal turnover cap.
 */
export function selectMonthlyConsensusCandidates(options = {}) {
  const profile = options.profile ?? {};
  const targetCount = Math.max(
    0,
    Math.floor(nonNegativeNumber(options.targetCount ?? profile.targetCount, 0))
  );
  if (!targetCount) return [];

  const candidates = Array.isArray(options.candidates)
    ? options.candidates.filter((item) => item && typeof item === 'object')
    : [];
  const bySymbol = new Map();
  for (const candidate of candidates) {
    const identity = identityOf(candidate);
    const score = finiteNumber(candidate?.consensusScore);
    if (!identity || score == null) continue;
    const normalized = { ...candidate, _identity: identity, consensusScore: round(score) };
    const existing = bySymbol.get(identity);
    if (!existing || selectionSort(normalized, existing) < 0) bySymbol.set(identity, normalized);
  }
  const ranked = [...bySymbol.values()].sort(selectionSort).map((candidate, index) => ({
    ...candidate,
    consensusRank: index + 1,
  }));
  const candidateBySymbol = new Map(ranked.map((candidate) => [candidate._identity, candidate]));
  const maxPerGroup = Math.max(
    0,
    Math.floor(nonNegativeNumber(options.maxPerGroup, 0))
  );
  const selectionGroup = options.selectionGroup;
  const groupOf = (candidate) => {
    if (!maxPerGroup || typeof selectionGroup !== 'function') return '';
    try {
      return String(selectionGroup(candidate, profile) ?? '').trim();
    } catch {
      return '';
    }
  };
  const canPlace = (candidate, selected, replacing = null) => {
    if (!maxPerGroup || typeof selectionGroup !== 'function') return true;
    const group = groupOf(candidate);
    if (!group) return true;
    const replacingIdentity = replacing?._identity ?? null;
    const count = selected.reduce((total, item) => {
      if (replacingIdentity && item._identity === replacingIdentity) return total;
      return total + (groupOf(item) === group ? 1 : 0);
    }, 0);
    return count < maxPerGroup;
  };

  const previousBySymbol = new Map();
  for (const holding of previousHoldings(options.previousPortfolio)) {
    const identity = identityOf(holding);
    if (identity && !previousBySymbol.has(identity)) previousBySymbol.set(identity, holding);
  }

  if (!previousBySymbol.size) {
    const diversified = [];
    for (const candidate of ranked) {
      if (diversified.length >= targetCount) break;
      if (canPlace(candidate, diversified)) diversified.push(candidate);
    }
    return diversified.map((candidate, index) => {
      const { _identity, ...publicCandidate } = candidate;
      return {
        ...publicCandidate,
        modelImportanceRank: index + 1,
        carriedFromPrevious: false,
        selectionReason: 'highest-consensus',
      };
    });
  }

  const rankMultiplier = positiveNumber(
    options.carryoverRankMultiplier,
    MODEL_PORTFOLIO_CONSENSUS_DEFAULTS.carryoverRankMultiplier
  );
  const carryoverRankLimit = Math.ceil(targetCount * rankMultiplier);
  const challengerMargin = nonNegativeNumber(
    options.challengerMargin,
    MODEL_PORTFOLIO_CONSENSUS_DEFAULTS.challengerMargin
  );
  const maxNormalTurnover = turnoverCap(options, profile, targetCount);
  const excludedPreviousSymbols = new Set();
  const retainable = [];

  for (const [identity, holding] of previousBySymbol) {
    const candidate = candidateBySymbol.get(identity);
    const forcedExit =
      !candidate ||
      candidate.consensusRank > carryoverRankLimit ||
      hardExit(holding, candidate, profile, options.isHardExit);
    if (forcedExit) {
      excludedPreviousSymbols.add(identity);
      continue;
    }
    retainable.push({
      ...candidate,
      carriedFromPrevious: true,
      selectionReason: 'eligible-carryover',
    });
  }

  retainable.sort(selectionSort);
  const selected = [];
  for (const incumbent of retainable) {
    if (selected.length < targetCount && canPlace(incumbent, selected)) {
      selected.push(incumbent);
    } else {
      excludedPreviousSymbols.add(incumbent._identity);
    }
  }

  const challengers = ranked.filter(
    (candidate) =>
      !previousBySymbol.has(candidate._identity) &&
      !selected.some((selectedCandidate) => selectedCandidate._identity === candidate._identity)
  );

  // Vacancies caused by a hard/eligibility/rank-buffer exit are filled freely;
  // they do not force an unsafe incumbent to stay merely to satisfy a cap.
  while (selected.length < targetCount && challengers.length) {
    const challengerIndex = challengers.findIndex((candidate) => canPlace(candidate, selected));
    if (challengerIndex < 0) break;
    const [challenger] = challengers.splice(challengerIndex, 1);
    selected.push({
      ...challenger,
      carriedFromPrevious: false,
      selectionReason: excludedPreviousSymbols.size
        ? 'forced-exit-replacement'
        : 'new-selection',
    });
  }

  let normalTurnover = 0;
  while (normalTurnover < maxNormalTurnover && challengers.length) {
    const incumbents = selected
      .filter((candidate) => candidate.carriedFromPrevious)
      .sort(
        (left, right) =>
          Number(left.consensusScore ?? 0) - Number(right.consensusScore ?? 0) ||
          compareSymbols(left._identity, right._identity)
      );
    let replacement = null;
    for (let challengerIndex = 0; challengerIndex < challengers.length; challengerIndex += 1) {
      const challenger = challengers[challengerIndex];
      const weakestIncumbent = incumbents.find(
        (incumbent) =>
          challenger.consensusScore - incumbent.consensusScore >= challengerMargin &&
          canPlace(challenger, selected, incumbent)
      );
      if (weakestIncumbent) {
        replacement = { challenger, challengerIndex, weakestIncumbent };
        break;
      }
    }
    if (!replacement) break;

    const { challenger, challengerIndex, weakestIncumbent } = replacement;
    challengers.splice(challengerIndex, 1);
    const index = selected.findIndex(
      (candidate) => candidate._identity === weakestIncumbent._identity
    );
    selected[index] = {
      ...challenger,
      carriedFromPrevious: false,
      selectionReason: 'challenger-margin',
    };
    normalTurnover += 1;
  }

  return selected.sort(selectionSort).map((candidate, index) => {
    const { _identity, ...publicCandidate } = candidate;
    return { ...publicCandidate, modelImportanceRank: index + 1 };
  });
}

/** Build ranks and the final carryover-aware selection in one call. */
export function buildMonthlyConsensusSelection(options = {}) {
  const rankedCandidates = buildMonthlyConsensusCandidates(options);
  const selectedCandidates = selectMonthlyConsensusCandidates({
    ...options,
    candidates: rankedCandidates,
  });
  return { rankedCandidates, selectedCandidates };
}

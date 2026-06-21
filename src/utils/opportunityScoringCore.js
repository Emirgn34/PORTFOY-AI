/**
 * Fırsat skor motoru — SAF çekirdek (React/lucide bağımlılığı YOK).
 * Hem tarayıcı (opportunityScoring.js buradan re-export eder) hem de Node
 * toplayıcısı (backtest skor anlık görüntüsü) bu dosyayı doğrudan kullanır.
 *
 * Skor, etiket ve sıralama HER ZAMAN buradaki fonksiyonlarla scoreBreakdown'dan
 * türetilir; mock dataya yazılmaz.
 *
 * Vade-uyum düzeltmeleri:
 *  1. Katalizör tazeliği (kısa vade): haber katalizörünün etkisi zamanla azalır
 *     (2 gün tam etki, sonra 7 gün yarı ömürle üstel çürüme, taban 0.4).
 *  2. Momentum fizibilitesi (kısa vade): momentum + hacim zayıfsa skor kırpılır.
 *  3. Değer tuzağı koruması (uzun vade): ucuz görünüp büyümeyen profilde tavan.
 */

/** Kısa vade: haber katalizörü + momentum ağırlıklı. */
export const SHORT_TERM_SCORE_WEIGHTS = [
  { key: 'newsCatalystScore', label: 'Haber Katalizörü', weight: 0.25 },
  { key: 'newsReliabilityScore', label: 'Haber Güvenilirliği', weight: 0.15 },
  { key: 'technicalMomentumScore', label: 'Teknik Momentum', weight: 0.2 },
  { key: 'volumeConfirmationScore', label: 'Hacim Teyidi', weight: 0.15 },
  { key: 'riskAdjustedScore', label: 'Risk Ayarlı Skor', weight: 0.1 },
  { key: 'liquidityScore', label: 'Likidite', weight: 0.1 },
  { key: 'sectorMarketFitScore', label: 'Sektör/Piyasa Uyumu', weight: 0.05 },
];

/**
 * Uzun vade: temel analiz ağırlıklı. Uzun vadede kısa vadeli haber ve hacim
 * sinyalleri yerine bilanço sağlamlığı, değerleme ve büyüme belirleyicidir.
 */
export const LONG_TERM_SCORE_WEIGHTS = [
  { key: 'fundamentalHealthScore', label: 'Temel Sağlamlık', weight: 0.25 },
  { key: 'valuationScore', label: 'Değerleme', weight: 0.2 },
  { key: 'growthScore', label: 'Büyüme Görünümü', weight: 0.2 },
  { key: 'dividendScore', label: 'Temettü & Nakit Akışı', weight: 0.1 },
  { key: 'newsReliabilityScore', label: 'Haber Güvenilirliği', weight: 0.1 },
  { key: 'sectorMarketFitScore', label: 'Sektör/Piyasa Uyumu', weight: 0.1 },
  { key: 'liquidityScore', label: 'Likidite', weight: 0.05 },
];

/** Ortalama haber güvenilirliği eşiğin altındaysa, gate uygulanan bileşen orantılı kırpılır. */
export const RELIABILITY_GATE_THRESHOLD = 4;

/** Yüksek riskli adaylar bu skorun üzerine çıkamaz ("Çok Güçlü Potansiyel" bandına giremez). */
export const HIGH_RISK_SCORE_CAP = 84;

/** Katalizör tazeliği: tam etki penceresi (gün) ve yarı ömür (gün). */
export const CATALYST_FRESH_WINDOW_DAYS = 2;
export const CATALYST_HALF_LIFE_DAYS = 7;
/** Çürüme tabanı: katalizör ne kadar eskirse eskisin etkisi bunun altına inmez. */
export const CATALYST_DECAY_FLOOR = 0.4;

/** Hareket potansiyeli eşiği: altındaysa kısa vade skoru orantılı kırpılır. */
export const MOVE_POTENTIAL_THRESHOLD = 60;
/** Hareket potansiyeli sıfır olsa bile skor en fazla bu orana kadar kırpılır. */
export const MOVE_POTENTIAL_MIN_FACTOR = 0.7;

/** Değer tuzağı profili: ucuz değerleme + zayıf büyüme → skor tavanı. */
export const VALUE_TRAP_VALUATION_MIN = 85;
export const VALUE_TRAP_GROWTH_MAX = 40;
export const VALUE_TRAP_SCORE_CAP = 74;

/**
 * Likidite bozulması (uzun vade): cari oran 1'in altında VE son çeyreklerde
 * düşüyorsa, şirketin kısa vadeli borç ödeme gücü zayıflıyor demektir. Bu güçlü
 * bir temel bozulma sinyalidir → uzun vade skoruna tavan uygulanır.
 */
export const LIQUIDITY_GUARD_SCORE_CAP = 68;

export const HORIZON_CONFIGS = {
  short: {
    value: 'short',
    label: 'Kısa Vade',
    weights: SHORT_TERM_SCORE_WEIGHTS,
    // Kısa vadede teyitsiz haber katalizörü kırpılır
    reliabilityGateKey: 'newsCatalystScore',
    // Kısa vadede katalizör tazeliği ve momentum fizibilitesi uygulanır
    applyCatalystDecay: true,
    applyMoveFeasibility: true,
    applyValueTrapGuard: false,
    applyLiquidityGuard: false,
  },
  long: {
    value: 'long',
    label: 'Uzun Vade',
    weights: LONG_TERM_SCORE_WEIGHTS,
    // Uzun vadede skor habere değil temellere dayandığı için gate uygulanmaz
    reliabilityGateKey: null,
    applyCatalystDecay: false,
    applyMoveFeasibility: false,
    applyValueTrapGuard: true,
    // Cari oran bozulması (likidite) uzun vadede temel bir risktir → tavan uygulanır
    applyLiquidityGuard: true,
  },
};

/**
 * Katalizör tazelik çarpanı. İlk CATALYST_FRESH_WINDOW_DAYS gün tam etki,
 * sonrasında CATALYST_HALF_LIFE_DAYS yarı ömürle üstel çürüme (taban: FLOOR).
 */
export function getCatalystFreshness(catalystDate, referenceDate) {
  if (!catalystDate || !referenceDate) return { factor: 1, daysSince: null };

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysSince = Math.max(
    0,
    (new Date(referenceDate) - new Date(catalystDate)) / msPerDay
  );
  if (Number.isNaN(daysSince)) return { factor: 1, daysSince: null };

  const staleDays = Math.max(0, daysSince - CATALYST_FRESH_WINDOW_DAYS);
  const factor = Math.max(
    CATALYST_DECAY_FLOOR,
    Math.pow(0.5, staleDays / CATALYST_HALF_LIFE_DAYS)
  );
  return { factor, daysSince: Math.round(daysSince) };
}

/** Kısa vadede fiyat hareketini üretecek gücün bileşik ölçüsü. */
export function getMovePotential(breakdown) {
  const momentum = breakdown.technicalMomentumScore ?? 0;
  const volume = breakdown.volumeConfirmationScore ?? 0;
  return 0.6 * momentum + 0.4 * volume;
}

/** Hareket potansiyeli eşik altındaysa [MIN_FACTOR, 1] aralığında kırpma çarpanı. */
export function getMoveFeasibilityFactor(movePotential) {
  if (movePotential >= MOVE_POTENTIAL_THRESHOLD) return 1;
  return (
    MOVE_POTENTIAL_MIN_FACTOR +
    (1 - MOVE_POTENTIAL_MIN_FACTOR) * (movePotential / MOVE_POTENTIAL_THRESHOLD)
  );
}

/** Ucuz görünen ama büyümeyen hisse profili (value trap) tespiti. */
export function isValueTrapProfile(breakdown) {
  return (
    (breakdown.valuationScore ?? 0) >= VALUE_TRAP_VALUATION_MIN &&
    (breakdown.growthScore ?? 100) <= VALUE_TRAP_GROWTH_MAX
  );
}

/** Verilen ağırlık setiyle ağırlıklı fırsat skoru hesaplar. */
export function calculateOpportunityScore(breakdown, weights, context = {}) {
  const {
    averageNewsReliability,
    riskLevel,
    reliabilityGateKey,
    catalystDecayFactor,
    catalystDecayKey = 'newsCatalystScore',
    moveFeasibilityFactor,
    applyValueTrapGuard,
    applyLiquidityGuard,
  } = context;

  let score = 0;
  for (const { key, weight } of weights) {
    let value = breakdown[key] ?? 0;
    if (
      key === reliabilityGateKey &&
      typeof averageNewsReliability === 'number' &&
      averageNewsReliability < RELIABILITY_GATE_THRESHOLD
    ) {
      value *= averageNewsReliability / RELIABILITY_GATE_THRESHOLD;
    }
    if (key === catalystDecayKey && typeof catalystDecayFactor === 'number') {
      value *= catalystDecayFactor;
    }
    score += value * weight;
  }

  if (typeof moveFeasibilityFactor === 'number') {
    score *= moveFeasibilityFactor;
  }

  if (riskLevel === 'Yüksek') {
    score = Math.min(score, HIGH_RISK_SCORE_CAP);
  }

  if (applyValueTrapGuard && isValueTrapProfile(breakdown)) {
    score = Math.min(score, VALUE_TRAP_SCORE_CAP);
  }

  // Cari oran 1'in altında ve düşüyorsa (çağıran tarafça doğrulanır) tavan uygula
  if (applyLiquidityGuard) {
    score = Math.min(score, LIQUIDITY_GUARD_SCORE_CAP);
  }

  return Math.round(score);
}

/**
 * Bir aday için nihai skor + uygulanmış düzeltme bayraklarını döndürür.
 * referenceDate: verinin üretildiği an (katalizör tazeliği buna göre ölçülür).
 */
export function getScoreDetails(candidate, horizon = 'short', referenceDate = null) {
  const config = HORIZON_CONFIGS[horizon];
  const breakdown = candidate.scoreBreakdown;

  const freshness = config.applyCatalystDecay
    ? getCatalystFreshness(candidate.catalystDate, referenceDate)
    : { factor: 1, daysSince: null };

  const movePotential = getMovePotential(breakdown);
  const feasibilityFactor = config.applyMoveFeasibility
    ? getMoveFeasibilityFactor(movePotential)
    : 1;

  // Cari oran 1'in altında ve düşüyorsa likidite guard'ı bağlar (yalnızca uzun vade)
  const liquidityRisk = Boolean(
    config.applyLiquidityGuard &&
      candidate.currentRatioBelowOne &&
      candidate.currentRatioDeclining
  );

  // Ham skor: hiçbir düzeltme uygulanmadan saf ağırlıklı toplam
  const rawScore = calculateOpportunityScore(breakdown, config.weights);

  const score = calculateOpportunityScore(breakdown, config.weights, {
    averageNewsReliability: candidate.averageNewsReliability,
    riskLevel: candidate.riskLevel,
    reliabilityGateKey: config.reliabilityGateKey,
    catalystDecayFactor: freshness.factor,
    moveFeasibilityFactor: feasibilityFactor,
    applyValueTrapGuard: config.applyValueTrapGuard,
    applyLiquidityGuard: liquidityRisk,
  });

  // Tavan bayrağı: tavan öncesi (kırpılmış) skor gerçekten tavanı aşıyor muydu?
  const scoreBeforeCaps = calculateOpportunityScore(breakdown, config.weights, {
    averageNewsReliability: candidate.averageNewsReliability,
    reliabilityGateKey: config.reliabilityGateKey,
    catalystDecayFactor: freshness.factor,
    moveFeasibilityFactor: feasibilityFactor,
  });

  return {
    shortTermScore: score, // tarihsel isim; her iki vade için de "fırsat skoru"
    rawScore,
    scoreLabel: getScoreLabel(score),
    isGated:
      Boolean(config.reliabilityGateKey) &&
      candidate.averageNewsReliability < RELIABILITY_GATE_THRESHOLD,
    isCapped:
      candidate.riskLevel === 'Yüksek' && scoreBeforeCaps > HIGH_RISK_SCORE_CAP,
    isDecayed: freshness.factor < 0.99,
    catalystFreshnessFactor: freshness.factor,
    daysSinceCatalyst: freshness.daysSince,
    isMomentumLimited: feasibilityFactor < 0.99,
    movePotential: Math.round(movePotential),
    isValueTrapRisk: config.applyValueTrapGuard && isValueTrapProfile(breakdown),
    isLiquidityRisk: liquidityRisk,
  };
}

/** Adayları seçilen vade konfigürasyonuyla skorlar, sıralar ve sıra numarası atar. */
export function scoreAndRankCandidates(candidates, horizon = 'short', referenceDate = null) {
  return candidates
    .map((candidate) => ({ ...candidate, ...getScoreDetails(candidate, horizon, referenceDate) }))
    .sort((a, b) => b.shortTermScore - a.shortTermScore)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

/**
 * Skor renkleri — sakin/kurumsal palet (yeşil / amber / kırmızı; neon yok).
 * 90+ koyu yeşil, 75+ yeşil, 60+ amber, 40+ açık amber, altı kırmızı.
 * stroke değerleri kart sol kenarlığı ve grafiklerde kullanılır.
 */
export function getScoreColor(score) {
  if (score >= 90) {
    return {
      text: 'text-gain',
      bg: 'bg-gain',
      badge: 'bg-gain/15 text-gain border-gain/40',
      stroke: '#1d6b46',
    };
  }
  if (score >= 75) {
    return {
      text: 'text-gain',
      bg: 'bg-gain',
      badge: 'bg-gain/15 text-gain border-gain/30',
      stroke: '#287a50',
    };
  }
  if (score >= 60) {
    return {
      text: 'text-amber-400',
      bg: 'bg-amber-400',
      badge: 'bg-amber-400/15 text-amber-400 border-amber-400/30',
      stroke: '#a06a24',
    };
  }
  if (score >= 40) {
    return {
      text: 'text-amber-400',
      bg: 'bg-amber-400',
      badge: 'bg-amber-400/15 text-amber-400 border-amber-400/30',
      stroke: '#bd863a',
    };
  }
  return {
    text: 'text-loss',
    bg: 'bg-loss',
    badge: 'bg-loss/15 text-loss border-loss/30',
    stroke: '#b54747',
  };
}

/**
 * Skoru en çok yukarı taşıyan ve en çok aşağı çeken bileşeni döndürür
 * (kartta modal açmadan görünür "mini gerekçe" için). Verilen ağırlık
 * setindeki ham alt-skorlardan en yüksek (best) ve en düşük (worst) seçilir.
 */
export function getTopFactors(breakdown, weights) {
  if (!breakdown || !weights?.length) return { best: null, worst: null };
  let best = null;
  let worst = null;
  for (const { key, label } of weights) {
    const value = breakdown[key];
    if (typeof value !== 'number') continue;
    if (!best || value > best.value) best = { label, value };
    if (!worst || value < worst.value) worst = { label, value };
  }
  return { best, worst };
}

export function getScoreLabel(score) {
  if (score >= 90) return 'Çok Güçlü Potansiyel';
  if (score >= 75) return 'Güçlü Potansiyel';
  if (score >= 60) return 'Orta Potansiyel';
  if (score >= 40) return 'Dikkatli İzlenmeli';
  return 'Zayıf';
}

export function getRiskColor(riskLevel) {
  if (riskLevel === 'Düşük') return 'bg-gain/15 text-gain border-gain/30';
  if (riskLevel === 'Orta') return 'bg-amber-400/15 text-amber-400 border-amber-400/30';
  return 'bg-loss/15 text-loss border-loss/30';
}

/** 1-10 haber güvenilirlik puanı renkleri. */
export function getReliabilityColor(score) {
  if (score >= 7) return { text: 'text-gain', badge: 'bg-gain/15 text-gain border-gain/30', bg: 'bg-gain' };
  if (score >= 4) {
    return {
      text: 'text-amber-400',
      badge: 'bg-amber-400/15 text-amber-400 border-amber-400/30',
      bg: 'bg-amber-400',
    };
  }
  return { text: 'text-loss', badge: 'bg-loss/15 text-loss border-loss/30', bg: 'bg-loss' };
}

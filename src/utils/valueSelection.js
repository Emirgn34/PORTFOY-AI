import { buildModelPortfolios, isUsEquity, MODEL_PORTFOLIO_PROFILES } from './modelPortfolioCore.js';

const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const median = (values) => {
  const sorted = values.filter(positive).sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null;
};

// Ucuzluk: aynı sektördeki analiz havuzuna göre F/K ve PD/DD iskontosu.
// Negatif/eksik çarpanlar ucuz sayılmaz; fiyatın tek başına düşmesi yeterli değildir.
export function assessValuations(candidates) {
  const peers = new Map();
  for (const candidate of candidates.filter(isUsEquity)) {
    const group = peers.get(candidate.sector) ?? new Map();
    group.set(candidate.symbol, candidate);
    peers.set(candidate.sector, group);
  }
  return candidates.map((candidate) => {
    const f = candidate.fundamentals ?? {};
    const group = [...(peers.get(candidate.sector)?.values() ?? [])];
    const ratios = [['peRatio', 'F/K'], ['priceToBook', 'PD/DD']].flatMap(([key, label]) => {
      const sample = group.map((item) => item.fundamentals?.[key]).filter(positive);
      const reference = median(sample);
      return sample.length >= 5 && positive(f[key]) && reference
        ? [{ label, value: f[key], sectorMedian: reference, discountPct: (1 - f[key] / reference) * 100 }]
        : [];
    });
    const discount = ratios.length ? ratios.reduce((sum, item) => sum + item.discountPct, 0) / ratios.length : null;
    const healthy = Number.isFinite(f.profitMarginPct) && f.profitMarginPct > 0
      && Number.isFinite(f.revenueGrowthPct) && f.revenueGrowthPct >= 0
      && (f.currentRatio == null || f.currentRatio >= 1 || /financ|bank|finans/i.test(candidate.sector ?? ''));
    const eligible = isUsEquity(candidate) && healthy && discount != null && discount >= 10;
    return { ...candidate, valuation: {
      eligible, score: discount == null ? null : Math.max(0, Math.min(100, 50 + discount)),
      discountPct: discount == null ? null : Math.round(discount * 10) / 10,
      peerCount: group.length, ratios,
      reason: !ratios.length ? 'Sektör karşılaştırması için yeterli çarpan verisi yok.'
        : !healthy ? 'Kârlılık, büyüme veya likidite kontrolünü geçmedi.'
          : eligible ? 'Sektör analiz havuzuna göre en az %10 iskonto.' : 'En az %10 iskonto eşiğini geçmedi.',
    } };
  });
}

export function validatePortfolioPreferences(input = {}) {
  const result = {};
  for (const { slug } of MODEL_PORTFOLIO_PROFILES) {
    const settings = input[slug] ?? {};
    result[slug] = {};
    for (const key of ['include', 'exclude']) {
      if (settings[key] != null && !Array.isArray(settings[key])) throw new Error('Hisse listesi geçersiz.');
      const symbols = [...new Set((settings[key] ?? []).map((s) => String(s).trim().toUpperCase()))];
      if (symbols.length > 30 || symbols.some((s) => !/^[A-Z][A-Z0-9-]{0,9}$/.test(s))) {
        throw new Error('Her liste en fazla 30 ABD hisse kodu içerebilir (ör. AAPL, BRK-B).');
      }
      result[slug][key] = symbols;
    }
    if (result[slug].include.length > 10) throw new Error('Bir sepete en fazla 10 manuel hisse eklenebilir.');
    if (result[slug].include.some((s) => result[slug].exclude.includes(s))) throw new Error('Aynı hisse hem eklenip hem çıkarılamaz.');
  }
  return result;
}

export function buildValuePortfolios({ rows, preferences = {}, generatedAt = new Date().toISOString() }) {
  const settings = validatePortfolioPreferences(preferences);
  const long = rows.filter((r) => r.horizon === 'long').map((r) => r.data);
  const valuations = new Map(assessValuations(long).map((c) => [c.symbol, c.valuation]));
  const all = rows.map((r) => ({ ...r.data, horizon: r.horizon, valuation: valuations.get(r.data.symbol) }));
  return MODEL_PORTFOLIO_PROFILES.map((profile) => {
    const { include, exclude } = settings[profile.slug];
    const candidates = all.filter((c) => !exclude.includes(c.symbol));
    const portfolio = buildModelPortfolios({
      shortCandidates: candidates.filter((c) => c.horizon === 'short'),
      longCandidates: candidates.filter((c) => c.horizon === 'long'),
      generatedAt, valueFocus: true,
    }).find((p) => p.slug === profile.slug);
    // Kullanıcı tercihi kalite/ucuzluk seçiminden ayrı etiketlenir.
    for (const symbol of include) {
      const candidate = candidates.find((c) => c.symbol === symbol && c.horizon === profile.horizon && isUsEquity(c));
      if (!candidate || candidate.analysisDepth !== 'deep' || !(candidate.currentPrice > 0)) {
        throw new Error(`${symbol} için güncel, derin ABD hisse analizi alınamadı. Önceki sepet korundu.`);
      }
      const existing = portfolio.holdings.find((h) => h.ticker === symbol);
      if (existing) { existing.manual = true; continue; }
      portfolio.holdings.unshift({
        ticker: symbol, sourceSymbol: symbol, companyName: candidate.companyName,
        market: candidate.market, currency: 'USD', sector: candidate.sector,
        currentPriceAtGeneration: candidate.currentPrice, manual: true, valuation: candidate.valuation,
        target: { price: candidate.expectation?.expectedPrice ?? null },
      });
    }
    portfolio.holdings = [...portfolio.holdings.filter((h) => h.manual), ...portfolio.holdings.filter((h) => !h.manual)]
      .slice(0, Math.max(profile.targetCount, include.length));
    const weight = Math.floor(Math.min(profile.maxPositionPct, (100 - profile.cashReservePct) / (portfolio.holdings.length || 1)) * 10) / 10;
    portfolio.holdings.forEach((h, i) => { h.weightPct = weight; h.modelImportanceRank = i + 1; });
    portfolio.cashWeightPct = Number((100 - weight * portfolio.holdings.length).toFixed(1));
    return { ...portfolio, slug: `value-${profile.slug}`, profileSlug: profile.slug,
      versionKey: `value-${profile.slug}--${generatedAt}`, rebalanceFrequency: 'manual',
      selection: { ...portfolio.selection, method: 'sector-discount-v1' }, preferences: settings[profile.slug] };
  });
}

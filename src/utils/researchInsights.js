const THEMES = [
  {
    slug: 'ai-infrastructure',
    name: 'Yapay Zekâ Altyapısı',
    // Genel "teknoloji/yazılım" etiketi tek başına AI altyapısı sayılmaz.
    pattern: /artificial intelligence|machine learning|generative ai|data cent(?:er|re)|cloud infrastructure|gpu|accelerator|semiconductor|networking hardware|sunucu|veri merkezi|yapay zek[âa]/i,
  },
  {
    slug: 'semiconductors',
    name: 'Yarı İletkenler',
    pattern: /semiconductor|chip|integrated circuit/i,
  },
  {
    slug: 'electrification',
    name: 'Batarya & Elektrifikasyon',
    // Genel enerji/otomotiv şirketlerini batarya teması gibi göstermemek için
    // yalnız doğrudan değer-zinciri ifadeleri kullanılır.
    pattern: /battery|lithium|nickel|cobalt|electric vehicle|ev charging|charging station|power electronics|electrical equipment|transformer|grid equipment|batarya|lityum|elektrikli ara[çc]|şarj|trafo/i,
  },
  {
    slug: 'biotechnology',
    name: 'Biyoteknoloji & Sağlık',
    pattern: /biotech|pharma|drug|health|medical|ilaç|sağlık/i,
  },
];

export function getThemeTags(candidate) {
  const haystack = [candidate?.sector, candidate?.industry, candidate?.companyName]
    .filter(Boolean)
    .join(' ');
  return THEMES.filter((theme) => theme.pattern.test(haystack)).map((theme) => theme.slug);
}

export function buildThemeInsights(candidates) {
  return THEMES.map((theme) => {
    const members = (candidates ?? []).filter((candidate) => getThemeTags(candidate).includes(theme.slug));
    const withMargin = members.filter((candidate) => candidate.fundamentals?.profitMarginPct != null);
    const withGrowth = members.filter((candidate) => candidate.fundamentals?.revenueGrowthPct != null);
    return {
      slug: theme.slug,
      name: theme.name,
      count: members.length,
      averageScore: members.length
        ? Math.round(members.reduce((sum, candidate) => sum + (candidate.shortTermScore ?? 0), 0) / members.length)
        : null,
      profitableSharePct: withMargin.length
        ? Math.round(
            (withMargin.filter((candidate) => candidate.fundamentals.profitMarginPct > 0).length /
              withMargin.length) *
              100
          )
        : null,
      profitabilityCoverageCount: withMargin.length,
      growthCoverageCount: withGrowth.length,
      averageSalesGrowthPct: withGrowth.length
        ? Number(
            (
              withGrowth.reduce(
                (sum, candidate) => sum + candidate.fundamentals.revenueGrowthPct,
                0
              ) / withGrowth.length
            ).toFixed(1)
          )
        : null,
      leaders: [...members]
        .sort((a, b) => (b.shortTermScore ?? 0) - (a.shortTermScore ?? 0))
        .slice(0, 3)
        .map((candidate) => candidate.symbol),
    };
  });
}

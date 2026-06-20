/**
 * Haber önem skoru — "önemli haberleri öne çıkarma" için bileşik bir sinyal.
 *
 * Tek bir haberin kullanıcı için ne kadar önemli olduğunu 0-100 bandında tahmin
 * eder. Bileşenler: kaynak güvenilirliği, duygu gücü, ileriye dönük katalizör,
 * tazelik ve kullanıcının portföy/izleme listesiyle ilgisi. Skor yalnızca
 * SIRALAMA ve VURGU için kullanılır; yatırım tavsiyesi üretmez.
 */

/** Haberin kullanıcıyla ilişkisi: 'portfolio' | 'watchlist' | null */
export function getNewsRelevance(news, { portfolioTickers, watchlistTickers } = {}) {
  if (portfolioTickers?.has(news.ticker)) return 'portfolio';
  if (watchlistTickers?.has(news.ticker)) return 'watchlist';
  return null;
}

/** 0-100 bileşik önem skoru. */
export function getNewsImportance(news, sets = {}) {
  let score = 0;

  // Kaynak güvenilirliği (0-10 → 0-35)
  score += (typeof news.reliability === 'number' ? news.reliability : 5) * 3.5;

  // Duygu gücü: yönlü (pozitif/negatif) haber, nötrden daha önemlidir
  if (news.sentiment === 'positive' || news.sentiment === 'negative') score += 12;

  // İleriye dönük katalizör (sözleşme, hedef fiyat, satın alma, bilanço sürprizi...)
  if (news.isCatalyst) score += 22;

  // Tazelik
  const ageHours = (Date.now() - new Date(news.date).getTime()) / 3_600_000;
  if (Number.isFinite(ageHours)) {
    if (ageHours <= 24) score += 18;
    else if (ageHours <= 72) score += 11;
    else if (ageHours <= 168) score += 5;
  }

  // Portföy / izleme listesi ilgisi
  const relevance = getNewsRelevance(news, sets);
  if (relevance === 'portfolio') score += 25;
  else if (relevance === 'watchlist') score += 13;

  return Math.round(Math.min(100, score));
}

/** Önem seviyesi etiketi (eşikler vurgu için ayarlanabilir). */
export function getImportanceLevel(score) {
  if (score >= 68) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

/** Haber nesnesine önem + ilgi alanlarını ekler (liste eşlemesinde kullanılır). */
export function withNewsImportance(news, sets = {}) {
  const importance = getNewsImportance(news, sets);
  return {
    ...news,
    importance,
    importanceLevel: getImportanceLevel(importance),
    relevance: getNewsRelevance(news, sets),
  };
}

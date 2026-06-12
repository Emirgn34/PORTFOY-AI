/**
 * Canlı veri servis katmanı.
 * Lokal veri sunucusuna (server/index.js, port 8787) Vite proxy'si
 * üzerinden bağlanır. Sunucu kapalıysa fonksiyonlar null döner ve
 * uygulama mock/manuel verilerle çalışmaya devam eder.
 */

/** Uygulamadaki hisse kaydını Yahoo Finance sembolüne çevirir. */
export function toYahooSymbol(stock) {
  const ticker = (stock.ticker ?? stock.symbol ?? '').toUpperCase();
  return stock.market === 'BIST' ? `${ticker}.IS` : ticker;
}

/** Yahoo sembolünden uygulama ticker'ına döner (THYAO.IS → THYAO). */
export function fromYahooSymbol(symbol) {
  return symbol.replace(/\.IS$/, '');
}

async function getJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // sunucu kapalı — sessizce mock'a düş
  }
}

/**
 * Hisse listesi için canlı fiyatları getirir.
 * Dönüş: Map<ticker, { price, changePercent, currency, marketState }>
 */
export async function fetchLiveQuotes(stocks) {
  if (!stocks?.length) return null;
  const symbols = [...new Set(stocks.map(toYahooSymbol))].join(',');
  const data = await getJson(`/api/quotes?symbols=${encodeURIComponent(symbols)}`);
  if (!data?.quotes) return null;

  const byTicker = new Map();
  for (const q of data.quotes) {
    byTicker.set(fromYahooSymbol(q.symbol), q);
  }
  return byTicker;
}

/** Güncel USD/TRY ve EUR/TRY kurları. Dönüş: { USD, EUR } veya null. */
export async function fetchLiveFx() {
  const data = await getJson('/api/fx');
  return data?.rates?.USD ? data.rates : null;
}

/**
 * Sembol listesi için canlı haberleri getirir (ABD: Yahoo Finance,
 * BIST: Türkçe finans medyası / Google News).
 */
export async function fetchLiveNews(stocks) {
  if (!stocks?.length) return null;
  const symbols = [...new Set(stocks.map(toYahooSymbol))].join(',');
  const data = await getJson(`/api/news?symbols=${encodeURIComponent(symbols)}`);
  return data?.articles ?? null;
}

/**
 * Hisse kodu/isim araması (form otomatik tamamlama).
 * Dönüş: [{ symbol, ticker, name, market }] veya sunucu kapalıysa null.
 */
export async function searchSymbols(query) {
  if (!query || query.trim().length < 1) return [];
  const data = await getJson(`/api/search?q=${encodeURIComponent(query.trim())}`);
  return data?.results ?? null;
}

/**
 * Seçilen sembolün form doldurma profili: şirket adı, pazar, para birimi,
 * güncel fiyat, günlük değişim ve sektör.
 */
export async function fetchSymbolProfile(symbol) {
  const data = await getJson(`/api/profile?symbol=${encodeURIComponent(symbol)}`);
  return data?.profile ?? null;
}

/** Yayıncı adından kaba güvenilirlik tahmini (AI analizi bağlanana dek). */
const PUBLISHER_RELIABILITY = [
  [/reuters|bloomberg|associated press|wall street journal|financial times/i, 9],
  [/kap|sec filing|globenewswire|business wire|pr newswire/i, 8],
  [/yahoo finance|cnbc|barron|marketwatch|investing\.com|ekonomim|dünya|bigpara|bloomberght/i, 7],
  [/zacks|motley fool|simply wall st|benzinga|insider monkey|paratic|mynet|borsagundem/i, 6],
];

export function estimatePublisherReliability(publisher = '') {
  for (const [pattern, score] of PUBLISHER_RELIABILITY) {
    if (pattern.test(publisher)) return score;
  }
  return 5;
}

/**
 * Canlı haber kaydını uygulamanın haber şemasına dönüştürür.
 * Sentiment/güvenilirlik AI analizi bağlanana kadar tarafsız varsayılır.
 */
export function mapLiveArticleToNews(article, companyByTicker = new Map()) {
  const ticker = fromYahooSymbol(article.symbol);
  return {
    id: `live-${article.id}`,
    ticker,
    company: companyByTicker.get(ticker) ?? ticker,
    title: article.title,
    summary: `${article.publisher} kaynağından canlı haber. Detay için habere tıklayın.`,
    content:
      'Bu haber canlı kaynaktan otomatik çekildi. AI analiz motoru bağlandığında ' +
      'özet, duygu analizi ve güvenilirlik gerekçesi otomatik üretilecektir.',
    type: 'Genel Haber',
    date: article.publishedAt ?? new Date().toISOString(),
    source: article.publisher,
    sentiment: 'neutral',
    reliability: estimatePublisherReliability(article.publisher),
    reliabilityReason:
      'Güvenilirlik puanı şimdilik kaynak/yayıncı bazlı tahmindir; AI analizi henüz uygulanmadı.',
    sentimentExplanation:
      'Duygu analizi henüz uygulanmadı; AI motoru bağlanana kadar nötr varsayılır.',
    confirmedSources: [article.publisher],
    isLive: true,
    link: article.link,
  };
}

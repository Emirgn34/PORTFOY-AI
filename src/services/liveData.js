/**
 * Canlı veri servis katmanı — iki kademeli:
 *   1. Lokal veri sunucusu (server/index.js, port 8787, Vite proxy'siyle /api)
 *   2. O yoksa Supabase bulut tabloları (GitHub Actions toplayıcısı doldurur)
 * İkisi de yoksa fonksiyonlar null döner ve uygulama mock/manuel verilerle
 * çalışmaya devam eder.
 *
 * Supabase erişimi için ortam değişkenleri (Vercel'de tanımlanır):
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const HAS_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Supabase REST okuma (anon anahtar; RLS yalnızca okumaya izin verir). */
async function sbGet(pathAndQuery) {
  if (!HAS_SUPABASE) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** PostgREST in.(...) filtresi için sembol listesi hazırlar. */
function sbInFilter(symbols) {
  return `in.(${symbols.map((s) => `"${s}"`).join(',')})`;
}

/**
 * Yeni sembolleri bulut izleme listesine kaydeder (toplayıcı sonraki turda
 * veri çekmeye başlar). Hata olursa sessizce geçilir.
 */
function sbRegisterSymbols(symbols) {
  if (!HAS_SUPABASE || symbols.length === 0) return;
  fetch(`${SUPABASE_URL}/rest/v1/tracked_symbols`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates',
    },
    body: JSON.stringify(symbols.map((symbol) => ({ symbol }))),
  }).catch(() => {});
}

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
  const symbols = [...new Set(stocks.map(toYahooSymbol))];

  // 1. kademe: lokal veri sunucusu
  const data = await getJson(`/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`);
  let quotes = data?.quotes ?? null;

  // 2. kademe: Supabase bulut tabloları
  if (!quotes) {
    sbRegisterSymbols(symbols); // yeni semboller sonraki toplayıcı turunda izlemeye girer
    const rows = await sbGet(`quotes?symbol=${sbInFilter(symbols)}&select=*`);
    if (rows?.length) {
      quotes = rows.map((r) => ({
        symbol: r.symbol,
        shortName: r.short_name,
        currency: r.currency,
        price: r.price,
        changePercent: r.change_percent,
        marketState: r.market_state,
        fetchedAt: Date.parse(r.updated_at),
      }));
    }
  }

  if (!quotes) return null;
  const byTicker = new Map();
  for (const q of quotes) {
    byTicker.set(fromYahooSymbol(q.symbol), q);
  }
  return byTicker;
}

/** Güncel USD/TRY ve EUR/TRY kurları. Dönüş: { USD, EUR } veya null. */
export async function fetchLiveFx() {
  const data = await getJson('/api/fx');
  if (data?.rates?.USD) return data.rates;

  const rows = await sbGet('fx_rates?select=*');
  if (!rows?.length) return null;
  const rates = {};
  for (const r of rows) rates[r.code] = r.rate;
  return rates.USD ? rates : null;
}

/**
 * Sembol listesi için canlı haberleri getirir (ABD: Yahoo Finance,
 * BIST: Türkçe finans medyası / Google News).
 */
export async function fetchLiveNews(stocks) {
  if (!stocks?.length) return null;
  const symbols = [...new Set(stocks.map(toYahooSymbol))];

  const data = await getJson(`/api/news?symbols=${encodeURIComponent(symbols.join(','))}`);
  if (data?.articles) return data.articles;

  const rows = await sbGet(
    `news?symbol=${sbInFilter(symbols)}&select=*&order=published_at.desc.nullslast&limit=150`
  );
  if (!rows?.length) return null;
  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    title: r.title,
    publisher: r.publisher,
    link: r.link,
    publishedAt: r.published_at,
  }));
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

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

import { supabase, HAS_SUPABASE, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient.js';

/**
 * Supabase REST istekleri için başlıklar. RLS artık yalnızca giriş yapmış
 * kullanıcıya okuma izni verir; bu yüzden Authorization olarak kullanıcının
 * erişim token'ı gönderilir (yoksa anon — o durumda kilitli tablolar boş döner).
 */
async function sbHeaders(extra = {}) {
  let token = SUPABASE_ANON_KEY;
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) token = data.session.access_token;
  }
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, ...extra };
}

/** Supabase REST okuma (giriş yapan kullanıcının kimliğiyle; RLS korumalı). */
async function sbGet(pathAndQuery) {
  if (!HAS_SUPABASE) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
      headers: await sbHeaders(),
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
async function sbRegisterSymbols(symbols) {
  if (!HAS_SUPABASE || symbols.length === 0) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/tracked_symbols`, {
      method: 'POST',
      headers: await sbHeaders({
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates',
      }),
      body: JSON.stringify(symbols.map((symbol) => ({ symbol }))),
    });
  } catch {
    // sembol kaydı kritik değil — sessizce geçilir
  }
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
    titleTr: r.title_tr,
    publisher: r.publisher,
    link: r.link,
    publishedAt: r.published_at,
    sentiment: r.sentiment ?? null,
    reliability: r.reliability ?? null,
    aiSummaryTr: r.ai_summary_tr ?? null,
  }));
}

/**
 * Fırsat adaylarını bulut tablosundan getirir (toplayıcı üretir).
 * Dönüş: aday nesnesi dizisi (mock şemasıyla birebir) veya veri yoksa null.
 * Veri yoksa çağıran taraf mock listeye düşer.
 */
export async function fetchLiveCandidates(horizon) {
  const rows = await sbGet(
    `candidates?horizon=eq.${encodeURIComponent(horizon)}&select=data&order=updated_at.desc`
  );
  if (!rows?.length) return null;
  return rows.map((r) => r.data).filter(Boolean);
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
  const isTranslated = Boolean(article.titleTr);
  const hasAi = Boolean(article.sentiment); // AI analizi çalıştıysa duygu dolu olur
  return {
    id: `live-${article.id}`,
    ticker,
    company: companyByTicker.get(ticker) ?? ticker,
    title: article.titleTr ?? article.title,
    originalTitle: isTranslated ? article.title : null,
    market: article.symbol.endsWith('.IS') ? 'BIST' : 'ABD',
    summary:
      article.aiSummaryTr ??
      `${article.publisher} kaynağından canlı haber. Detay için habere tıklayın.`,
    content:
      (isTranslated ? `Orijinal başlık: "${article.title}"\n\n` : '') +
      (article.aiSummaryTr
        ? `AI özeti: ${article.aiSummaryTr}\n\nTam metin için habere tıklayın.`
        : 'Bu haber canlı kaynaktan otomatik çekildi. AI analiz motoru bağlandığında ' +
          'özet, duygu analizi ve güvenilirlik gerekçesi otomatik üretilecektir.'),
    type: 'Genel Haber',
    date: article.publishedAt ?? new Date().toISOString(),
    source: article.publisher,
    sentiment: article.sentiment ?? 'neutral',
    reliability: article.reliability ?? estimatePublisherReliability(article.publisher),
    reliabilityReason: hasAi
      ? 'Güvenilirlik, kaynağın itibarı ve başlığın tonuna göre AI (Haiku 4.5) tarafından değerlendirildi.'
      : 'Güvenilirlik puanı şimdilik kaynak/yayıncı bazlı tahmindir; AI analizi henüz uygulanmadı.',
    sentimentExplanation: hasAi
      ? 'Duygu, haberin ilgili hisse açısından tonuna göre AI (Haiku 4.5) tarafından belirlendi.'
      : 'Duygu analizi henüz uygulanmadı; AI motoru bağlanana kadar nötr varsayılır.',
    confirmedSources: [article.publisher],
    isLive: true,
    link: article.link,
  };
}

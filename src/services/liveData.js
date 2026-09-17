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

/**
 * PostgREST'in sunucu tarafındaki satır sınırına takılmadan tüm sayfaları okur.
 * Her sayfa başarılı olmadan sonuç döndürmez; böylece ağ hatası sessizce eksik
 * bir performans geçmişi gibi gösterilmez.
 */
async function sbGetAll(pathAndQuery, { pageSize = 1000 } = {}) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const separator = pathAndQuery.includes('?') ? '&' : '?';
    const page = await sbGet(
      `${pathAndQuery}${separator}limit=${pageSize}&offset=${offset}`
    );
    if (!Array.isArray(page)) return null;
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function chunked(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
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
        Prefer: 'resolution=ignore-duplicates,missing=default',
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

/**
 * Hisse listesi için seçilen dönemdeki yüzde değişimleri getirir
 * (+ USD/EUR kur değişimi). Dönüş: { SEMBOL: yüzde, 'USDTRY=X': yüzde, ... } veya null.
 * Geçmiş verisi yalnızca canlı sunucu/Vercel fonksiyonundan gelir (havuz tablosu yok).
 */
export async function fetchPeriodChanges(stocks, range) {
  if (!stocks?.length) return null;
  const symbols = [...new Set(stocks.map(toYahooSymbol))];
  const data = await getJson(
    `/api/history?symbols=${encodeURIComponent(symbols.join(','))}&range=${encodeURIComponent(range)}`
  );
  return data?.changes ?? null;
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
export async function fetchLiveNews(stocks, { limit = 300 } = {}) {
  if (!stocks?.length) return null;
  const symbols = [...new Set(stocks.map(toYahooSymbol))];

  const data = await getJson(`/api/news?symbols=${encodeURIComponent(symbols.join(','))}`);
  if (data?.articles) return data.articles;

  // Tutulan/izlenen semboller toplayıcıya kaydedilir; sonraki turda haberleri birikmeye başlar
  // (özellikle yeni eklenen portföy hisseleri için "ne olursa olsun haber gelsin" güvencesi).
  sbRegisterSymbols(symbols);
  const rows = await sbGet(
    `news?symbol=${sbInFilter(symbols)}&select=*&order=published_at.desc.nullslast&limit=${limit}`
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
 * Dönüş: { candidates, generatedAt } veya veri yoksa null.
 *   - candidates: aday nesnesi dizisi (mock şemasıyla birebir)
 *   - generatedAt: en güncel adayın gerçek üretilme zamanı (bayatlık göstergesi
 *     ve katalizör tazeliği bu ana göre ölçülür — sayfa açılış anına göre değil).
 * Veri yoksa çağıran taraf mock listeye düşer.
 */
export async function fetchLiveCandidates(horizon) {
  const rows = await sbGet(
    `candidates?horizon=eq.${encodeURIComponent(horizon)}&select=data,updated_at,generation&order=generation.desc.nullslast,updated_at.desc`
  );
  if (!rows?.length) return null;
  // Bayat temizliği bir turda başarısız olsa bile farklı jenerasyonları karıştırma.
  // Legacy satırlarda generation NULL olabilir; Number(null) === 0 olduğu için
  // filtrelemeden dönüştürmek tarihi yanlışlıkla 1970'e çevirirdi.
  const generations = rows
    .filter((row) => row.generation != null && row.generation !== '')
    .map((row) => Number(row.generation))
    .filter(Number.isFinite);
  const latestGeneration = generations.length ? Math.max(...generations) : null;
  const latestRows = latestGeneration == null
    ? rows
    : rows.filter((row) => Number(row.generation) === latestGeneration);
  const candidates = latestRows.map((r) => r.data).filter(Boolean);
  if (!candidates.length) return null;
  // Olay nöbeti updated_at'i değiştirebilir; yapısal analiz zamanı jenerasyondur.
  const generatedAt = latestGeneration != null
    ? new Date(latestGeneration).toISOString()
    : latestRows[0]?.updated_at ?? null;
  return { candidates, generatedAt, generation: latestGeneration };
}

/** Ortak dört model portföy snapshot'ını getirir. */
export async function fetchLiveModelPortfolios() {
  const rows = await sbGet(
    'model_portfolios?select=slug,risk_tier,source_generation,generated_at,valid_until,data&order=risk_tier.asc'
  );
  if (!rows?.length) return null;
  const portfolios = rows.map((row) => row.data).filter(Boolean);
  return portfolios.length ? portfolios : null;
}

/**
 * Aylık, değişmez model portföy sürümleri ile günlük TL NAV noktalarını getirir.
 * Migration uygulanmamışsa null döner ve çağıran current snapshot'a düşer.
 */
export async function fetchLiveModelPortfolioTracking() {
  if (!HAS_SUPABASE) return null;
  const rows = await sbGetAll(
    'model_portfolio_versions?' +
      'select=version_key,slug,risk_tier,source_generation,cycle_start,cycle_end,status,data' +
      '&order=cycle_start.asc,risk_tier.asc,version_key.asc'
  );
  if (rows === null) {
    return { error: 'Model portföy performans geçmişi şu an okunamadı.' };
  }
  if (!rows?.length) return null;

  const latestCycleStart = rows.reduce(
    (latest, row) =>
      String(row?.cycle_start ?? '').localeCompare(String(latest ?? '')) > 0
        ? row.cycle_start
        : latest,
    null
  );
  const currentRows = rows
    .filter((row) => row.cycle_start === latestCycleStart)
    .sort((a, b) => a.risk_tier - b.risk_tier);
  if (!currentRows.length) return null;
  const currentSlugs = new Set(currentRows.map((row) => row.slug).filter(Boolean));
  const currentRiskTiers = new Set(
    currentRows.map((row) => Number(row.risk_tier)).filter(Number.isFinite)
  );
  if (currentRows.length !== 4 || currentSlugs.size !== 4 || currentRiskTiers.size !== 4) {
    return {
      error: 'En güncel aylık model portföy sürümü dört benzersiz profil içermiyor.',
    };
  }

  const versionKeys = [...new Set(rows.map((row) => row.version_key).filter(Boolean))].sort();
  const navRows = [];
  // URL uzunluğunu makul tutarken her parçayı ayrıca sayfala. Herhangi bir
  // parça başarısızsa kısmi geçmiş döndürmek yerine tüm tracking isteğini düşür.
  for (const versionKeyChunk of chunked(versionKeys, 50)) {
    const chunkRows = await sbGetAll(
      `model_portfolio_nav?version_key=${sbInFilter(versionKeyChunk)}` +
        '&select=version_key,nav_date,observed_at,nav_value,return_pct,coverage_pct,benchmarks' +
        '&order=version_key.asc,nav_date.asc'
    );
    if (!Array.isArray(chunkRows)) {
      return { error: 'Model portföy NAV geçmişinin bir bölümü okunamadı.' };
    }
    navRows.push(...chunkRows);
  }
  navRows.sort(
    (a, b) =>
      String(a.version_key).localeCompare(String(b.version_key)) ||
      String(a.nav_date).localeCompare(String(b.nav_date)) ||
      String(a.observed_at).localeCompare(String(b.observed_at))
  );

  return {
    portfolios: currentRows.map((row) => ({
      ...row.data,
      versionKey: row.version_key,
      cycleStart: row.cycle_start,
      cycleEnd: row.cycle_end,
      cycleStatus: row.status,
    })),
    versions: rows.map((row) => ({
      versionKey: row.version_key,
      slug: row.slug,
      riskTier: row.risk_tier,
      cycleStart: row.cycle_start,
      cycleEnd: row.cycle_end,
      status: row.status,
      data: row.data,
    })),
    navRows,
  };
}

/**
 * TÜM güncel haberleri (sembol filtresi olmadan) bulut havuzundan getirir.
 * "Tüm Hisseler" kapsamı için: izlenen tüm sembollerin haberleri karışık gelir.
 * Dönüş: makale dizisi veya veri yoksa null.
 */
export async function fetchAllLiveNews({ limit = 400 } = {}) {
  const rows = await sbGet(
    `news?select=*&order=published_at.desc.nullslast&limit=${limit}`
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
 *
 * Duygu ve güvenilirlik KURAL MOTORUNDAN gelir (toplayıcıdaki
 * server/newsHeuristics.js): duygu başlık kalıplarından, güvenilirlik yayıncı
 * itibarından. Arşivdeki eski kayıtlarda AI özeti (ai_summary_tr) bulunabilir;
 * varsa gösterilir, yenilerinde üretilmez.
 */
export function mapLiveArticleToNews(article, companyByTicker = new Map()) {
  const ticker = fromYahooSymbol(article.symbol);
  const isTranslated = Boolean(article.titleTr);
  const hasAiSummary = Boolean(article.aiSummaryTr); // yalnızca eski arşiv kayıtlarında
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
        ? `Özet: ${article.aiSummaryTr}\n\nTam metin için habere tıklayın.`
        : 'Bu haber canlı kaynaktan otomatik çekildi; tam metin için habere tıklayın.'),
    type: 'Genel Haber',
    date: article.publishedAt ?? new Date().toISOString(),
    source: article.publisher,
    sentiment: article.sentiment ?? 'neutral',
    reliability: article.reliability ?? estimatePublisherReliability(article.publisher),
    reliabilityReason:
      'Güvenilirlik, haberin geldiği yayıncının itibarına göre verilir (ajans/resmi bildirim ' +
      'yüksek, spekülatif bloglar düşük).',
    sentimentExplanation: hasAiSummary
      ? 'Duygu, arşivdeki AI analizinden gelir.'
      : 'Duygu, başlıktaki olay ve ton kalıplarından belirlenir; kararsız başlıklar nötr sayılır.',
    confirmedSources: [article.publisher],
    isLive: true,
    link: article.link,
  };
}

/**
 * Yahoo Finance + Google News veri çekme fonksiyonları.
 * Hem lokal sunucu (index.js) hem bulut toplayıcı (collect.js) tarafından
 * kullanılır — mantık tek yerde durur, iki taraf birbirinden sapamaz.
 */
import { mapLimit } from './concurrency.js';

export function mapQuote(q) {
  return {
    symbol: q.symbol,
    shortName: q.shortName ?? q.longName ?? q.symbol,
    currency: q.currency ?? null,
    price: q.regularMarketPrice ?? null,
    changePercent: q.regularMarketChangePercent ?? null,
    previousClose: q.regularMarketPreviousClose ?? null,
    marketState: q.marketState ?? null,
    exchange: q.fullExchangeName ?? q.exchange ?? null,
    marketTime: q.regularMarketTime ?? null,
  };
}

export function mapArticle(item, symbol) {
  return {
    id: item.uuid,
    symbol,
    title: item.title,
    publisher: item.publisher ?? 'Bilinmeyen Kaynak',
    link: item.link,
    publishedAt: item.providerPublishTime
      ? new Date(item.providerPublishTime).toISOString()
      : null,
    type: item.type ?? 'STORY',
  };
}

/**
 * Başlığa göre tekilleştirir (aynı haber iki kaynaktan farklı id'yle gelebilir).
 * Noktalama ve büyük/küçük harf normalleştirilir; ilk görülen kayıt tutulur.
 */
export function dedupeByTitle(articles) {
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    const key = (a.title ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9ğüşıöç]+/gi, ' ')
      .trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/**
 * Yahoo arama haberleri: relatedTickers sembolü içerenler yüksek alâkalıdır.
 * (Tek başına az makale döndürür; Google News ile birlikte kullanılır.)
 */
async function fetchUsNewsFromYahoo(yahooFinance, symbol) {
  try {
    const result = await yahooFinance.search(symbol, { newsCount: 20, quotesCount: 0 });
    return (result.news ?? [])
      .filter((n) => Array.isArray(n.relatedTickers) && n.relatedTickers.includes(symbol))
      .map((n) => mapArticle(n, symbol));
  } catch {
    return [];
  }
}

/**
 * ABD hisseleri: Yahoo (yüksek alâka) + Google News (geniş kapsam) birleştirilir,
 * başlık bazında teklenir. Tek kaynağa göre çok daha fazla haber döndürür.
 */
export async function fetchUsNews(yahooFinance, symbol) {
  const [yahoo, google] = await Promise.all([
    fetchUsNewsFromYahoo(yahooFinance, symbol),
    fetchGoogleNews(`${symbol} stock`, symbol, { hl: 'en-US', gl: 'US', ceid: 'US:en' }).catch(
      () => []
    ),
  ]);
  return dedupeByTitle([...yahoo, ...google]);
}

/** Google News RSS'inden basit alan çıkarımı (ek bağımlılık gerektirmez). */
export function parseRssItems(xml) {
  const items = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const block of itemBlocks) {
    const pick = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m
        ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').trim()
        : null;
    };
    items.push({
      title: pick('title'),
      link: pick('link'),
      pubDate: pick('pubDate'),
      source: pick('source'),
    });
  }
  return items;
}

/**
 * Google News RSS arama sonucunu uygulama makale şemasına çevirir
 * (ücretsiz, anahtarsız). ABD ve BIST haberlerinde ortak kullanılır.
 */
export async function fetchGoogleNews(query, symbol, { hl = 'en-US', gl = 'US', ceid = 'US:en' } = {}) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`RSS ${response.status}`);
  const xml = await response.text();
  return parseRssItems(xml)
    .filter((i) => i.title && i.link)
    .slice(0, 30)
    .map((i) => ({
      id: i.link,
      symbol,
      title: i.title.replace(/ - [^-]+$/, ''), // Google başlık sonuna kaynağı ekler
      publisher: i.source ?? 'Google News',
      link: i.link,
      publishedAt: i.pubDate ? new Date(i.pubDate).toISOString() : null,
      type: 'STORY',
    }));
}

/**
 * BIST hisseleri: Yahoo'nun BIST haber kapsamı zayıf olduğu için Türkçe
 * haberler Google News RSS üzerinden çekilir (ücretsiz, anahtarsız).
 */
export async function fetchBistNews(symbol) {
  const base = symbol.replace(/\.IS$/, '');
  return fetchGoogleNews(`${base} hisse`, symbol, { hl: 'tr', gl: 'TR', ceid: 'TR:tr' });
}

/** Sembole göre doğru haber kaynağını seçer. */
export async function fetchNewsForSymbolRaw(yahooFinance, symbol) {
  return symbol.endsWith('.IS') ? fetchBistNews(symbol) : fetchUsNews(yahooFinance, symbol);
}

/** Yahoo borsa kodundan uygulama pazar adına eşleme. */
export function mapExchangeToMarket(symbol, exchDisp = '') {
  if (symbol.endsWith('.IS')) return 'BIST';
  if (/nasdaq/i.test(exchDisp)) return 'NASDAQ';
  if (/nyse/i.test(exchDisp)) return 'NYSE';
  return exchDisp || 'Diğer';
}

export const SECTOR_TR = {
  Technology: 'Teknoloji',
  'Financial Services': 'Finans',
  Healthcare: 'Sağlık',
  Energy: 'Enerji',
  'Consumer Cyclical': 'Tüketim (Döngüsel)',
  'Consumer Defensive': 'Tüketim (Temel)',
  Industrials: 'Sanayi',
  'Communication Services': 'İletişim',
  'Basic Materials': 'Hammadde',
  'Real Estate': 'Gayrimenkul',
  Utilities: 'Altyapı / Enerji Dağıtım',
};

/** Döviz kuru sembolleri (TRY karşılıkları). */
export const FX_SYMBOLS = ['USDTRY=X', 'EURTRY=X'];

/** Dönemsel değişim pencereleri: gün sayısı + geçmiş örnekleme aralığı. */
export const PERIOD_RANGES = {
  '1d': { days: 1, interval: '1d' },
  '1w': { days: 7, interval: '1d' },
  '1mo': { days: 30, interval: '1d' },
  '3mo': { days: 91, interval: '1d' },
  '1y': { days: 365, interval: '1wk' },
  '3y': { days: 365 * 3, interval: '1wk' },
  '5y': { days: 365 * 5, interval: '1mo' },
};

const PERIOD_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Verilen semboller (+ USD/EUR kurları) için seçilen dönemdeki yüzde değişimi
 * hesaplar: her sembolün geçmiş grafiğinden dönem başı kapanışı ile en güncel
 * kapanış karşılaştırılır. Kur sembolleri de döndürülür; böylece dönem K/Z'sine
 * TRY açısından döviz hareketi de katılabilir.
 * Dönüş: { SEMBOL: yüzde, 'USDTRY=X': yüzde, 'EURTRY=X': yüzde }.
 */
export async function computePeriodChanges(yahooFinance, symbols, range) {
  const cfg = PERIOD_RANGES[range];
  if (!cfg) return {};
  const targetMs = Date.now() - cfg.days * PERIOD_DAY_MS;
  const period1 = new Date(Date.now() - (cfg.days * 1.3 + 10) * PERIOD_DAY_MS);
  const wanted = [...new Set([...symbols, ...FX_SYMBOLS])];
  const out = {};

  await Promise.all(
    wanted.map(async (symbol) => {
      try {
        const res = await yahooFinance.chart(symbol, { period1, interval: cfg.interval });
        const closes = (res?.quotes ?? []).filter((q) => q.close != null);
        if (closes.length < 2) return;
        const latest = closes[closes.length - 1].close;
        let baseline;
        if (range === '1d') {
          // "1 günlük" = son işlem gününün hareketi (hafta sonu/tatilde de doğru çalışır):
          // en güncel kapanış ile bir önceki kapanışı karşılaştır.
          baseline = closes[closes.length - 2].close;
        } else {
          // Dönem başı: hedef tarihten önceki son kapanış (yoksa en eski kapanış)
          baseline = closes[0].close;
          for (let i = closes.length - 1; i >= 0; i--) {
            if (new Date(closes[i].date).getTime() <= targetMs) {
              baseline = closes[i].close;
              break;
            }
          }
        }
        if (baseline > 0) out[symbol] = Number(((latest / baseline - 1) * 100).toFixed(2));
      } catch {
        // sembol için geçmiş yoksa atlanır
      }
    })
  );

  return out;
}

/**
 * Metni Türkçe'ye çevirir (ücretsiz Google Translate ucu, anahtarsız).
 * Başarısız olursa null döner; arayan orijinal metinle devam eder.
 */
export async function translateToTurkish(text) {
  if (!text) return null;
  try {
    const url =
      'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=tr&dt=t&q=' +
      encodeURIComponent(text);
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const translated = (data?.[0] ?? [])
      .map((seg) => seg?.[0] ?? '')
      .join('')
      .trim();
    return translated && translated !== text ? translated : null;
  } catch {
    return null;
  }
}

/**
 * Yabancı (BIST dışı) haberlerin başlıklarına Türkçe çeviri ekler (titleTr).
 * Yalnızca verilen makaleler işlenir — çağıran taraf sadece YENİ makaleleri
 * göndermelidir ki çeviri ucu gereksiz yere zorlanmasın.
 */
export async function addTurkishTitles(articles, symbol) {
  if (symbol.endsWith('.IS')) return articles; // BIST haberleri zaten Türkçe
  // Çeviriler birbirinden bağımsız → sınırlı eşzamanlılıkla paralel (ilk turun
  // en büyük yavaşlık kaynağıydı: sembol başına onlarca sıralı çeviri çağrısı).
  await mapLimit(articles, 5, async (article) => {
    article.titleTr = await translateToTurkish(article.title);
  });
  return articles;
}

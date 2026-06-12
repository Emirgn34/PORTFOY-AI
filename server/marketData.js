/**
 * Yahoo Finance + Google News veri çekme fonksiyonları.
 * Hem lokal sunucu (index.js) hem bulut toplayıcı (collect.js) tarafından
 * kullanılır — mantık tek yerde durur, iki taraf birbirinden sapamaz.
 */

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
 * ABD hisseleri: Yahoo arama sonucu, relatedTickers sembolü içeriyorsa alınır
 * (aksi halde genel piyasa haberi karışıyor).
 */
export async function fetchUsNews(yahooFinance, symbol) {
  const result = await yahooFinance.search(symbol, { newsCount: 12, quotesCount: 0 });
  return (result.news ?? [])
    .filter((n) => Array.isArray(n.relatedTickers) && n.relatedTickers.includes(symbol))
    .map((n) => mapArticle(n, symbol));
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
 * BIST hisseleri: Yahoo'nun BIST haber kapsamı zayıf olduğu için Türkçe
 * haberler Google News RSS üzerinden çekilir (ücretsiz, anahtarsız).
 */
export async function fetchBistNews(symbol) {
  const base = symbol.replace(/\.IS$/, '');
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    `${base} hisse`
  )}&hl=tr&gl=TR&ceid=TR:tr`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`RSS ${response.status}`);
  const xml = await response.text();
  return parseRssItems(xml)
    .filter((i) => i.title && i.link)
    .slice(0, 12)
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

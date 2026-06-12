/**
 * PortföyAI canlı veri sunucusu (lokal, ücretsiz).
 *
 * Yahoo Finance üzerinden ABD (NASDAQ/NYSE) ve BIST hisseleri için
 * gecikmeli fiyat + haber verisi çeker. API anahtarı gerektirmez.
 *
 * - /api/quotes?symbols=AAPL,THYAO.IS   → anlık fiyat/değişim (5 dk önbellek)
 * - /api/news?symbols=AAPL,ASELS.IS     → sembol bazlı haberler (15 dk önbellek)
 * - /api/fx                             → USD/TRY ve EUR/TRY kurları
 * - /api/status                         → sunucu durumu + izlenen semboller
 *
 * Bir kez istenen her sembol "izlenen" listesine eklenir ve cron her
 * 15 dakikada bir arka planda yeniler; haberler diske birikir (gözden
 * haber kaçmaz). Çalıştırma: `npm run server`
 */
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const TRACKED_FILE = path.join(DATA_DIR, 'tracked-symbols.json');
const NEWS_FILE = path.join(DATA_DIR, 'news-store.json');

const PORT = process.env.PORT || 8787;
const QUOTE_TTL_MS = 5 * 60 * 1000;
const NEWS_TTL_MS = 15 * 60 * 1000;
const FX_SYMBOLS = ['USDTRY=X', 'EURTRY=X'];

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/** Bir kez sorgulanan semboller kalıcı izleme listesine girer (cron yeniler). */
const tracked = new Set(readJson(TRACKED_FILE, []));
function trackSymbols(symbols) {
  let changed = false;
  for (const s of symbols) {
    if (s && !tracked.has(s)) {
      tracked.add(s);
      changed = true;
    }
  }
  if (changed) writeJson(TRACKED_FILE, [...tracked]);
}

// ---- Fiyatlar -------------------------------------------------------------

const quoteCache = new Map(); // symbol -> { data, fetchedAt }

function mapQuote(q) {
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

async function fetchQuotes(symbols, { force = false } = {}) {
  const now = Date.now();
  const stale = symbols.filter((s) => {
    const hit = quoteCache.get(s);
    return force || !hit || now - hit.fetchedAt > QUOTE_TTL_MS;
  });

  if (stale.length > 0) {
    try {
      const results = await yahooFinance.quote(stale);
      const list = Array.isArray(results) ? results : [results];
      for (const q of list) {
        quoteCache.set(q.symbol, { data: mapQuote(q), fetchedAt: now });
      }
    } catch (err) {
      console.error('[quotes] hata:', err.message);
    }
  }

  return symbols
    .map((s) => quoteCache.get(s))
    .filter(Boolean)
    .map((hit) => ({ ...hit.data, fetchedAt: hit.fetchedAt }));
}

// ---- Haberler ---------------------------------------------------------------

// newsStore: { [symbol]: Article[] } — diske yazılır, eskiler birikir.
const newsStore = readJson(NEWS_FILE, {});
const newsFetchedAt = new Map(); // symbol -> ts

function mapArticle(item, symbol) {
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
async function fetchUsNews(symbol) {
  const result = await yahooFinance.search(symbol, { newsCount: 12, quotesCount: 0 });
  return (result.news ?? [])
    .filter((n) => Array.isArray(n.relatedTickers) && n.relatedTickers.includes(symbol))
    .map((n) => mapArticle(n, symbol));
}

/** Google News RSS'inden basit alan çıkarımı (ek bağımlılık gerektirmez). */
function parseRssItems(xml) {
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
async function fetchBistNews(symbol) {
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

async function fetchNewsForSymbol(symbol, { force = false } = {}) {
  const now = Date.now();
  const last = newsFetchedAt.get(symbol) ?? 0;
  if (!force && now - last < NEWS_TTL_MS) return newsStore[symbol] ?? [];

  try {
    const fresh = symbol.endsWith('.IS')
      ? await fetchBistNews(symbol)
      : await fetchUsNews(symbol);
    const existing = newsStore[symbol] ?? [];
    const known = new Set(existing.map((a) => a.id));
    // Yeni haberler öne eklenir; eskiler silinmez (en fazla 200 kayıt tutulur)
    newsStore[symbol] = [...fresh.filter((a) => !known.has(a.id)), ...existing].slice(0, 200);
    newsFetchedAt.set(symbol, now);
    writeJson(NEWS_FILE, newsStore);
  } catch (err) {
    console.error(`[news] ${symbol} hata:`, err.message);
  }
  return newsStore[symbol] ?? [];
}

// ---- HTTP API ---------------------------------------------------------------

const app = express();
app.use(cors());

function parseSymbols(req) {
  return String(req.query.symbols ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

app.get('/api/quotes', async (req, res) => {
  const symbols = parseSymbols(req);
  if (symbols.length === 0) return res.status(400).json({ error: 'symbols parametresi gerekli' });
  trackSymbols(symbols);
  res.json({ quotes: await fetchQuotes(symbols) });
});

app.get('/api/fx', async (_req, res) => {
  const quotes = await fetchQuotes(FX_SYMBOLS);
  const rates = {};
  for (const q of quotes) {
    if (q.symbol === 'USDTRY=X') rates.USD = q.price;
    if (q.symbol === 'EURTRY=X') rates.EUR = q.price;
  }
  res.json({ rates, fetchedAt: quotes[0]?.fetchedAt ?? null });
});

app.get('/api/news', async (req, res) => {
  const symbols = parseSymbols(req);
  if (symbols.length === 0) return res.status(400).json({ error: 'symbols parametresi gerekli' });
  trackSymbols(symbols);
  const perSymbol = await Promise.all(symbols.map((s) => fetchNewsForSymbol(s)));
  // Sembol bazlı listeler tek akışta birleştirilir, link bazında teklenir
  const seen = new Set();
  const articles = perSymbol
    .flat()
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .sort((a, b) => new Date(b.publishedAt ?? 0) - new Date(a.publishedAt ?? 0));
  res.json({ articles });
});

// ---- Sembol arama + profil (form otomatik doldurma) -------------------------

/** Yahoo borsa kodundan uygulama pazar adına eşleme. */
function mapExchangeToMarket(symbol, exchDisp = '') {
  if (symbol.endsWith('.IS')) return 'BIST';
  if (/nasdaq/i.test(exchDisp)) return 'NASDAQ';
  if (/nyse/i.test(exchDisp)) return 'NYSE';
  return exchDisp || 'Diğer';
}

const SECTOR_TR = {
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

/**
 * Hisse kodu/isim araması: "MP" yazınca MPWR gibi eşleşmeleri döndürür.
 * Hem ABD hem BIST sembollerini kapsar.
 */
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 1) return res.json({ results: [] });

  try {
    const result = await yahooFinance.search(q, { quotesCount: 10, newsCount: 0 });
    const results = (result.quotes ?? [])
      .filter((item) => item.symbol && (item.quoteType === 'EQUITY' || item.quoteType === 'ETF'))
      .map((item) => ({
        symbol: item.symbol,
        ticker: item.symbol.replace(/\.IS$/, ''),
        name: item.shortname ?? item.longname ?? item.symbol,
        market: mapExchangeToMarket(item.symbol, item.exchDisp),
        quoteType: item.quoteType,
      }))
      // BIST ve ABD pazarları öncelikli, diğer borsalar sona
      .sort((a, b) => {
        const rank = (m) => (['BIST', 'NASDAQ', 'NYSE'].includes(m) ? 0 : 1);
        return rank(a.market) - rank(b.market);
      });
    res.json({ results });
  } catch (err) {
    console.error('[search] hata:', err.message);
    res.json({ results: [] });
  }
});

/**
 * Seçilen sembol için form doldurma profili: güncel fiyat, para birimi,
 * şirket adı, pazar ve (varsa) Türkçeleştirilmiş sektör.
 */
app.get('/api/profile', async (req, res) => {
  const symbol = String(req.query.symbol ?? '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol parametresi gerekli' });
  trackSymbols([symbol]);

  try {
    const q = await yahooFinance.quote(symbol);
    let sector = '';
    try {
      const summary = await yahooFinance.quoteSummary(symbol, { modules: ['assetProfile'] });
      const rawSector = summary.assetProfile?.sector;
      sector = SECTOR_TR[rawSector] ?? rawSector ?? '';
    } catch {
      // sektör bilgisi opsiyonel; bulunamazsa boş bırak
    }

    res.json({
      profile: {
        symbol: q.symbol,
        ticker: q.symbol.replace(/\.IS$/, ''),
        company: q.longName ?? q.shortName ?? q.symbol,
        market: mapExchangeToMarket(q.symbol, q.fullExchangeName),
        currency: q.currency ?? (q.symbol.endsWith('.IS') ? 'TRY' : 'USD'),
        currentPrice: q.regularMarketPrice ?? null,
        dailyChangePercent:
          typeof q.regularMarketChangePercent === 'number'
            ? Number(q.regularMarketChangePercent.toFixed(2))
            : null,
        sector,
      },
    });
  } catch (err) {
    console.error('[profile] hata:', err.message);
    res.status(404).json({ error: 'Sembol bulunamadı' });
  }
});

app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    trackedSymbols: [...tracked],
    cachedQuotes: quoteCache.size,
    newsSymbols: Object.keys(newsStore).length,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// ---- Arka plan yenileme (7/24) ----------------------------------------------

async function refreshAll() {
  const symbols = [...tracked];
  if (symbols.length === 0) return;
  console.log(`[cron] ${symbols.length} sembol yenileniyor...`);
  await fetchQuotes([...symbols, ...FX_SYMBOLS], { force: true });
  for (const s of symbols) {
    await fetchNewsForSymbol(s, { force: true });
  }
  console.log('[cron] tamamlandı.');
}

// Her 15 dakikada bir izlenen sembollerin fiyat + haberlerini tazele
cron.schedule('*/15 * * * *', refreshAll);

app.listen(PORT, () => {
  console.log(`PortföyAI veri sunucusu: http://localhost:${PORT}`);
  console.log(`İzlenen sembol sayısı: ${tracked.size}`);
  refreshAll();
});

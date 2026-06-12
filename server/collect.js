/**
 * Bulut veri toplayıcı — GitHub Actions üzerinde zamanlanmış çalışır.
 *
 * İzlenen sembollerin fiyatlarını, USD/EUR kurlarını ve haberlerini
 * Yahoo Finance + Google News'ten çekip Supabase'e yazar. Böylece
 * veriler PC kapalıyken de 7/24 birikir; Vercel'deki uygulama bu
 * tablolardan okur.
 *
 * Gerekli ortam değişkenleri (GitHub repo secrets olarak tanımlanır):
 *   SUPABASE_URL               https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  service_role anahtarı (RLS'i aşar, GİZLİ)
 *
 * Lokal test: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node server/collect.js
 */
import YahooFinance from 'yahoo-finance2';
import { mapQuote, fetchNewsForSymbolRaw, FX_SYMBOLS } from './marketData.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('HATA: SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY ortam değişkenleri gerekli.');
  process.exit(1);
}

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

/** Tablo henüz boşken izlemeye alınacak varsayılan semboller (seed verisiyle uyumlu). */
const DEFAULT_SYMBOLS = [
  'THYAO.IS', 'ASELS.IS', 'SISE.IS', 'TUPRS.IS', 'KCHOL.IS', 'SASA.IS', 'EREGL.IS',
  'AAPL', 'MSFT', 'NVDA',
];

/** Supabase PostgREST çağrısı. */
async function sb(pathAndQuery, { method = 'GET', body = null, prefer = null } = {}) {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${pathAndQuery} → ${res.status}: ${text.slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function getTrackedSymbols() {
  const rows = await sb('tracked_symbols?select=symbol');
  if (rows.length > 0) return rows.map((r) => r.symbol);

  console.log('İzleme tablosu boş; varsayılan semboller ekleniyor...');
  await sb('tracked_symbols', {
    method: 'POST',
    body: DEFAULT_SYMBOLS.map((symbol) => ({ symbol })),
    prefer: 'resolution=ignore-duplicates',
  });
  return DEFAULT_SYMBOLS;
}

async function collectQuotes(symbols) {
  const results = await yahooFinance.quote([...symbols, ...FX_SYMBOLS]);
  const list = (Array.isArray(results) ? results : [results]).map(mapQuote);

  const fxRows = [];
  const quoteRows = [];
  for (const q of list) {
    if (q.symbol === 'USDTRY=X') fxRows.push({ code: 'USD', rate: q.price, updated_at: new Date().toISOString() });
    else if (q.symbol === 'EURTRY=X') fxRows.push({ code: 'EUR', rate: q.price, updated_at: new Date().toISOString() });
    else if (q.price != null) {
      quoteRows.push({
        symbol: q.symbol,
        short_name: q.shortName,
        currency: q.currency,
        price: q.price,
        change_percent: q.changePercent,
        market_state: q.marketState,
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (quoteRows.length > 0) {
    await sb('quotes', { method: 'POST', body: quoteRows, prefer: 'resolution=merge-duplicates' });
  }
  if (fxRows.length > 0) {
    await sb('fx_rates', { method: 'POST', body: fxRows, prefer: 'resolution=merge-duplicates' });
  }
  console.log(`Fiyat: ${quoteRows.length} sembol, kur: ${fxRows.length} kayıt yazıldı.`);
}

async function collectNews(symbols) {
  let total = 0;
  for (const symbol of symbols) {
    try {
      const articles = await fetchNewsForSymbolRaw(yahooFinance, symbol);
      if (articles.length === 0) continue;
      await sb('news', {
        method: 'POST',
        body: articles.map((a) => ({
          id: a.id,
          symbol: a.symbol,
          title: a.title,
          publisher: a.publisher,
          link: a.link,
          published_at: a.publishedAt,
        })),
        prefer: 'resolution=ignore-duplicates', // eski haberler korunur, yeniler eklenir
      });
      total += articles.length;
    } catch (err) {
      console.error(`[news] ${symbol}: ${err.message}`);
    }
  }
  console.log(`Haber: ${symbols.length} sembol tarandı, ${total} makale işlendi.`);
}

const symbols = await getTrackedSymbols();
console.log(`${symbols.length} sembol izleniyor: ${symbols.join(', ')}`);
await collectQuotes(symbols);
await collectNews(symbols);
console.log('Toplama tamamlandı.');

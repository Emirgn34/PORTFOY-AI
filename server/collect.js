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
import { mapQuote, fetchNewsForSymbolRaw, addTurkishTitles, FX_SYMBOLS } from './marketData.js';
import { analyzeArticles, isAiEnabled } from './aiAnalysis.js';
import { buildCandidates, CANDIDATE_UNIVERSE } from './candidateBuilder.js';

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

      // Yalnızca veritabanında olmayan makaleler işlenir (çeviri maliyeti için)
      const existing = await sb(
        `news?symbol=eq.${encodeURIComponent(symbol)}&select=id`
      );
      const known = new Set(existing.map((r) => r.id));
      const fresh = await addTurkishTitles(
        articles.filter((a) => !known.has(a.id)),
        symbol
      );
      if (fresh.length === 0) continue;

      // Yeni makalelere AI duygu/güvenilirlik/özet analizi (anahtar yoksa boş döner)
      const market = symbol.endsWith('.IS') ? 'BIST' : 'ABD';
      const analysis = await analyzeArticles(
        fresh.map((a) => ({ id: a.id, title: a.title, publisher: a.publisher, market }))
      );

      await sb('news', {
        method: 'POST',
        body: fresh.map((a) => {
          const ai = analysis.get(a.id);
          return {
            id: a.id,
            symbol: a.symbol,
            title: a.title,
            title_tr: a.titleTr ?? null,
            publisher: a.publisher,
            link: a.link,
            published_at: a.publishedAt,
            // AI alanları yalnızca analiz çalıştıysa eklenir (kolonlar yoksa/anahtar
            // yoksa atlanır → ekleme her durumda çalışır)
            ...(ai && {
              sentiment: ai.sentiment,
              reliability: ai.reliability,
              ai_summary_tr: ai.summaryTr,
            }),
          };
        }),
        prefer: 'resolution=ignore-duplicates', // eski haberler korunur, yeniler eklenir
      });
      total += fresh.length;
    } catch (err) {
      console.error(`[news] ${symbol}: ${err.message}`);
    }
  }
  console.log(`Haber: ${symbols.length} sembol tarandı, ${total} yeni makale eklendi.`);
}

/** Bir sembolün son haberlerini Supabase'den okur (aday üretici için). */
async function getNewsForSymbol(symbol) {
  return sb(
    `news?symbol=eq.${encodeURIComponent(symbol)}&select=title,title_tr,publisher,link,published_at,sentiment,reliability,ai_summary_tr&order=published_at.desc.nullslast&limit=30`
  );
}

/** Küratörlü evren + izlenen semboller için fırsat adaylarını üretip yazar. */
async function collectCandidates(trackedSymbols) {
  const universe = [...new Set([...CANDIDATE_UNIVERSE, ...trackedSymbols])];
  console.log(`Aday üreticisi: ${universe.length} sembol taranıyor...`);
  const rows = await buildCandidates(universe, { yahooFinance, getNewsForSymbol });
  if (rows.length === 0) {
    console.log('Aday üretilemedi.');
    return;
  }
  await sb('candidates', {
    method: 'POST',
    body: rows.map((r) => ({
      symbol: r.symbol,
      horizon: r.horizon,
      market: r.market,
      data: r.data,
      updated_at: new Date().toISOString(),
    })),
    prefer: 'resolution=merge-duplicates', // sembol+vade başına tek satır güncellenir
  });
  console.log(`Aday: ${rows.length / 2} sembol için kısa+uzun vade adayı yazıldı.`);
}

const symbols = await getTrackedSymbols();
console.log(`AI haber analizi: ${isAiEnabled() ? 'AÇIK (Haiku 4.5)' : 'KAPALI (ANTHROPIC_API_KEY yok)'}`);
console.log(`${symbols.length} sembol izleniyor: ${symbols.join(', ')}`);
await collectQuotes(symbols);
await collectNews(symbols);
// Aday üretimi izole edilir: candidates tablosu henüz yoksa (kullanıcı SQL'i
// çalıştırmadıysa) ya da bir hata olursa fiyat/haber yazımı yine de korunur.
try {
  await collectCandidates(symbols);
} catch (err) {
  console.error(`[candidates] adım atlandı: ${err.message}`);
}
console.log('Toplama tamamlandı.');

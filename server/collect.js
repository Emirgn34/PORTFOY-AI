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
import { buildCandidates, CANDIDATE_UNIVERSE, fetchDynamicUniverse } from './candidateBuilder.js';
import { scoreAndRankCandidates } from '../src/utils/opportunityScoringCore.js';

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
          // TÜM satırlar AYNI anahtar kümesine sahip olmalı; aksi halde PostgREST
          // toplu insert'i "All object keys must match" (PGRST102) ile reddeder.
          // AI analizi gelmeyen haberlerde alanlar null olarak gönderilir.
          return {
            id: a.id,
            symbol: a.symbol,
            title: a.title,
            title_tr: a.titleTr ?? null,
            publisher: a.publisher,
            link: a.link,
            published_at: a.publishedAt,
            sentiment: ai?.sentiment ?? null,
            reliability: ai?.reliability ?? null,
            ai_summary_tr: ai?.summaryTr ?? null,
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

/**
 * Henüz AI analizi yapılmamış (sentiment NULL) eski haberleri kademeli olarak
 * analiz eder. Her turda sınırlı sayıda işlenir; birkaç tur içinde tüm arşiv
 * AI'ya kavuşur. Maliyet turu başına sabit kalır (self-healing backfill).
 */
async function backfillNewsAnalysis(limit = 50) {
  if (!isAiEnabled()) return;
  const rows = await sb(
    `news?sentiment=is.null&select=id,symbol,title,title_tr,publisher&order=published_at.desc.nullslast&limit=${limit}`
  );
  if (!rows?.length) return;

  const analysis = await analyzeArticles(
    rows.map((r) => ({
      id: r.id,
      title: r.title_tr || r.title,
      publisher: r.publisher,
      market: r.symbol.endsWith('.IS') ? 'BIST' : 'ABD',
    }))
  );

  let updated = 0;
  for (const r of rows) {
    const ai = analysis.get(r.id);
    if (!ai) continue;
    try {
      await sb(`news?id=eq.${encodeURIComponent(r.id)}`, {
        method: 'PATCH',
        body: { sentiment: ai.sentiment, reliability: ai.reliability, ai_summary_tr: ai.summaryTr },
      });
      updated++;
    } catch (err) {
      console.error(`[backfill] ${r.id}: ${err.message}`);
    }
  }
  console.log(`Backfill: ${updated}/${rows.length} eski haber AI ile güncellendi.`);
}

/** Bir sembolün son haberlerini Supabase'den okur (aday üretici için). */
async function getNewsForSymbol(symbol) {
  return sb(
    `news?symbol=eq.${encodeURIComponent(symbol)}&select=title,title_tr,publisher,link,published_at,sentiment,reliability,ai_summary_tr&order=published_at.desc.nullslast&limit=30`
  );
}

/** Her aday üretim turunda eklenecek dinamik (taramadan gelen) sembol tavanı. */
const MAX_DYNAMIC_SYMBOLS = 30;

/** Küratörlü + izlenen + dinamik (tarama) evren için fırsat adaylarını üretip yazar. */
async function collectCandidates(trackedSymbols) {
  const core = [...new Set([...CANDIDATE_UNIVERSE, ...trackedSymbols])];

  // Günlük yükselenler/en aktifler: küratörlü evrene ek, tavanla sınırlı.
  let dynamic = [];
  try {
    const found = await fetchDynamicUniverse(yahooFinance);
    dynamic = found.filter((s) => !core.includes(s)).slice(0, MAX_DYNAMIC_SYMBOLS);
  } catch (err) {
    console.error(`[candidates] dinamik evren atlandı: ${err.message}`);
  }

  const universe = [...core, ...dynamic];
  console.log(
    `Aday üreticisi: ${universe.length} sembol taranıyor ` +
      `(${core.length} küratörlü/izlenen + ${dynamic.length} dinamik tarama).`
  );
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

  // Backtest: bu turun skorlarının anlık görüntüsünü ayrı bir tabloya EKLE (append).
  // İleride vade dolunca bu skorların getiriyi öngörüp öngörmediği ölçülür.
  try {
    await snapshotScores(rows);
  } catch (err) {
    console.error(`[snapshot] adım atlandı: ${err.message}`);
  }
}

/** Aday skorlarını score_snapshots tablosuna ekler (backtest track record'u). */
async function snapshotScores(rows) {
  const referenceMs = Date.now();
  const byHorizon = { short: [], long: [] };
  for (const r of rows) {
    if (byHorizon[r.horizon]) byHorizon[r.horizon].push(r.data);
  }

  const snapshots = [];
  for (const horizon of ['short', 'long']) {
    const ranked = scoreAndRankCandidates(byHorizon[horizon], horizon, referenceMs);
    for (const c of ranked) {
      snapshots.push({
        symbol: c.symbol,
        horizon,
        market: c.market ?? null,
        score: c.shortTermScore,
        score_label: c.scoreLabel,
        rank: c.rank,
        capture_price: c.currentPrice ?? null,
        currency: c.currency ?? null,
      });
    }
  }

  if (snapshots.length === 0) return;
  await sb('score_snapshots', { method: 'POST', body: snapshots });
  console.log(`Backtest: ${snapshots.length} skor anlık görüntüsü kaydedildi.`);
}

// COLLECT_MODE ile iş ikiye ayrılır:
//   'data' (varsayılan): fiyat + kur + haber + AI backfill — sık çalışır (20 dk).
//   'candidates': yalnızca fırsat adayı üretimi — pahalı (geçmiş grafik), seyrek
//                 çalışır (6 saat). Adaylar zaten kendi fiyatını/geçmişini çeker
//                 ve haberleri DB'den okur; fiyat/haber işinden bağımsızdır.
const MODE = process.env.COLLECT_MODE || 'data';
const symbols = await getTrackedSymbols();
console.log(`Mod: ${MODE} | AI: ${isAiEnabled() ? 'AÇIK (Haiku 4.5)' : 'KAPALI'} | ${symbols.length} sembol izleniyor`);

if (MODE === 'candidates') {
  await collectCandidates(symbols);
} else {
  await collectQuotes(symbols);
  await collectNews(symbols);
  // Eski AI'sız haberleri kademeli doldur (izole; hata olsa da akış sürer)
  try {
    await backfillNewsAnalysis();
  } catch (err) {
    console.error(`[backfill] adım atlandı: ${err.message}`);
  }
}
console.log('Toplama tamamlandı.');

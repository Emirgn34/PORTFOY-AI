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
import { scoreAndRankCandidates } from '../src/utils/opportunityScoringCore.js';
import { getUsUniverse } from './usUniverse.js';
import { selectDeepPool } from './preScreen.js';
import { mapLimit } from './concurrency.js';

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

/** Faz 1 ön-elemesinden geçip derin analize aday olacak ABD havuzu boyutu. */
const DEEP_POOL_SIZE = 300;
/** Her vade için derin analiz + vitrin buffer'ı (ilk 30'u garantilemek için biraz fazlası). */
const DISPLAY_BUFFER = 45;
/** AI haber analizi yapılacak vitrin adayı sayısı (her vade). Maliyet/süre sınırı:
 *  AI (Haiku) yavaş olduğundan tüm derin havuza değil, yalnızca vitrindeki ilk
 *  30+30'a uygulanır; gerisi data workflow backfill'iyle zamanla dolar. */
const AI_TOP = 30;

/** Büyük sembol listesini parçalara bölerek toplu quote çeker (ham quote nesneleri). */
async function fetchQuotesChunked(symbols, chunkSize = 200, concurrency = 3) {
  const chunks = [];
  for (let i = 0; i < symbols.length; i += chunkSize) chunks.push(symbols.slice(i, i + chunkSize));
  const map = new Map();
  await mapLimit(chunks, concurrency, async (chunk, idx) => {
    try {
      const res = await yahooFinance.quote(chunk);
      for (const q of Array.isArray(res) ? res : [res]) map.set(q.symbol, q);
    } catch (err) {
      console.error(`[quotes] parça ${idx}: ${err.message}`);
    }
  });
  return map;
}

/**
 * Sembollerin haberlerini RSS'ten çekip YALNIZCA yeni HAM makaleleri kaydeder
 * (çeviri ve AI YOK — onlar gated sete enrichGatedNews'te uygulanır). Faz 2'de
 * 300 sembolün haberini ucuza biriktirmek için.
 */
async function collectNewsRaw(symbols) {
  let total = 0;
  await mapLimit(symbols, 5, async (symbol) => {
    try {
      const articles = await fetchNewsForSymbolRaw(yahooFinance, symbol);
      if (articles.length === 0) return;
      const existing = await sb(`news?symbol=eq.${encodeURIComponent(symbol)}&select=id`);
      const known = new Set((existing ?? []).map((r) => r.id));
      const fresh = articles.filter((a) => !known.has(a.id));
      if (fresh.length === 0) return;
      await sb('news', {
        method: 'POST',
        body: fresh.map((a) => ({
          id: a.id,
          symbol: a.symbol,
          title: a.title,
          publisher: a.publisher,
          link: a.link,
          published_at: a.publishedAt,
        })),
        prefer: 'resolution=ignore-duplicates',
      });
      total += fresh.length;
    } catch (err) {
      console.error(`[news-raw] ${symbol}: ${err.message}`);
    }
  });
  return total;
}

/**
 * Gated sembollerin (vitrin adayları) AI'sız haberlerine Türkçe çeviri + AI
 * duygu/güvenilirlik/özet ekler. Deep skor öncesi çalışır ki aday verisi
 * AI'lı haber bileşenini içersin.
 */
async function enrichGatedNews(symbols) {
  if (!symbols.length) return;
  let updated = 0;
  await mapLimit(symbols, 4, async (symbol) => {
    let rows;
    try {
      rows = await sb(
        `news?symbol=eq.${encodeURIComponent(symbol)}&sentiment=is.null&select=id,title,title_tr,publisher&order=published_at.desc.nullslast&limit=8`
      );
    } catch {
      return;
    }
    if (!rows?.length) return;

    // ABD haberlerinde eksik Türkçe başlıkları çevir (BIST zaten Türkçe)
    if (!symbol.endsWith('.IS')) {
      const needTr = rows.filter((r) => !r.title_tr).map((r) => ({ id: r.id, title: r.title }));
      const withTr = await addTurkishTitles(needTr, symbol);
      for (const a of withTr) {
        if (!a.titleTr) continue;
        try {
          await sb(`news?id=eq.${encodeURIComponent(a.id)}`, { method: 'PATCH', body: { title_tr: a.titleTr } });
        } catch {}
        const row = rows.find((r) => r.id === a.id);
        if (row) row.title_tr = a.titleTr;
      }
    }

    const market = symbol.endsWith('.IS') ? 'BIST' : 'ABD';
    const analysis = await analyzeArticles(
      rows.map((r) => ({ id: r.id, title: r.title_tr || r.title, publisher: r.publisher, market }))
    );
    for (const r of rows) {
      const ai = analysis.get(r.id);
      if (!ai) continue;
      try {
        await sb(`news?id=eq.${encodeURIComponent(r.id)}`, {
          method: 'PATCH',
          body: { sentiment: ai.sentiment, reliability: ai.reliability, ai_summary_tr: ai.summaryTr },
        });
        updated++;
      } catch {}
    }
  });
  console.log(`Gated haber AI: ${symbols.length} sembolde ${updated} makale güncellendi.`);
}

/** Aday satırlarını vadeye göre skorlayıp ilk N'in YAHOO sembollerini döndürür. */
function topYahooSymbols(rows, horizon, n, referenceMs) {
  const horizonRows = rows.filter((r) => r.horizon === horizon);
  const tickerToYahoo = new Map(horizonRows.map((r) => [r.data.symbol, r.symbol]));
  const ranked = scoreAndRankCandidates(horizonRows.map((r) => r.data), horizon, referenceMs);
  return ranked
    .slice(0, n)
    .map((c) => tickerToYahoo.get(c.symbol))
    .filter(Boolean);
}

/**
 * 3 fazlı fırsat üretimi:
 *   Faz 1 — tüm ABD evreni → ucuz ön-skor → en iyi 300
 *   Faz 2 — 300 (+BIST/çekirdek) → hafif analiz (2yıl YOK) + ham haber → ön sıralama
 *   Faz 3 — her vadede ilk ~45 → 2 yıllık ZORUNLU analiz + gated AI haber → yaz
 */
async function collectCandidates(trackedSymbols) {
  const referenceMs = Date.now();

  // --- FAZ 1 ---
  const usUniverse = await getUsUniverse(sb);
  const core = [...new Set([...CANDIDATE_UNIVERSE, ...trackedSymbols])]; // BIST + küratörlü + izlenen (her zaman analiz)
  const quoteSymbols = [...new Set([...usUniverse, ...core])];
  console.log(`Faz 1: ${quoteSymbols.length} sembol için toplu fiyat çekiliyor...`);
  const quoteMap = await fetchQuotesChunked(quoteSymbols);

  const usQuotes = usUniverse.map((s) => quoteMap.get(s)).filter(Boolean);
  const pool = selectDeepPool(usQuotes, { total: DEEP_POOL_SIZE });
  const faz2Symbols = [...new Set([...pool, ...core])];
  console.log(`Faz 1 bitti: ${pool.length} ABD havuzu + ${core.length} çekirdek/BIST → ${faz2Symbols.length} sembol Faz 2'ye.`);

  // --- FAZ 2 ---
  const newAdded = await collectNewsRaw(faz2Symbols);
  console.log(`Faz 2: ${newAdded} yeni ham haber eklendi. Hafif analiz yapılıyor...`);
  const lightRows = await buildCandidates(faz2Symbols, { yahooFinance, getNewsForSymbol, deep: false, quoteMap });
  if (lightRows.length === 0) {
    console.log('Faz 2: aday üretilemedi.');
    return;
  }
  const deepSet = [
    ...new Set([
      ...topYahooSymbols(lightRows, 'short', DISPLAY_BUFFER, referenceMs),
      ...topYahooSymbols(lightRows, 'long', DISPLAY_BUFFER, referenceMs),
    ]),
  ];
  // AI haber yalnızca vitrindeki ilk 30+30'a (deep havuzun tamamına değil) —
  // AI yavaş olduğundan maliyet/süre burada sınırlanır.
  const gatedSet = [
    ...new Set([
      ...topYahooSymbols(lightRows, 'short', AI_TOP, referenceMs),
      ...topYahooSymbols(lightRows, 'long', AI_TOP, referenceMs),
    ]),
  ];
  console.log(`Faz 2 bitti: ${deepSet.length} sembol derin analiz, ${gatedSet.length} sembol AI haber.`);

  // --- FAZ 3 ---
  await enrichGatedNews(gatedSet); // AI'lı haber, deep skor ÖNCESİ yazılır
  const deepRows = await buildCandidates(deepSet, { yahooFinance, getNewsForSymbol, deep: true, quoteMap });
  if (deepRows.length === 0) {
    console.log('Faz 3: derin aday üretilemedi.');
    return;
  }

  // "Şart koşma" doğrulaması: vitrindeki ilk 30 gerçekten 2 yıllık (deep) mı?
  for (const horizon of ['short', 'long']) {
    const ranked = scoreAndRankCandidates(
      deepRows.filter((r) => r.horizon === horizon).map((r) => r.data),
      horizon,
      referenceMs
    );
    const lightInTop = ranked.slice(0, 30).filter((c) => c.analysisDepth !== 'deep').length;
    if (lightInTop > 0) {
      console.warn(`[uyarı] ${horizon} ilk 30'da ${lightInTop} sembolün 2 yıllık verisi çekilemedi.`);
    }
  }

  // --- Yaz + bayat temizliği (jenerasyon) ---
  const generation = Date.now();
  await sb('candidates', {
    method: 'POST',
    body: deepRows.map((r) => ({
      symbol: r.symbol,
      horizon: r.horizon,
      market: r.market,
      data: r.data,
      generation,
      updated_at: new Date().toISOString(),
    })),
    prefer: 'resolution=merge-duplicates',
  });
  try {
    // Önceki turlardan kalan (veya jenerasyonsuz) satırları sil → liste bayatlamaz
    await sb(`candidates?or=(generation.is.null,generation.lt.${generation})`, { method: 'DELETE' });
  } catch (err) {
    console.error(`[candidates] bayat temizliği atlandı: ${err.message}`);
  }
  console.log(`Aday: ${deepRows.length / 2} sembol yazıldı (jenerasyon ${generation}).`);

  // Backtest skor anlık görüntüsü
  try {
    await snapshotScores(deepRows);
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

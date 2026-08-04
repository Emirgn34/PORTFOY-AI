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
import { buildNewsSignals } from './newsHeuristics.js';
import { buildCandidates, CANDIDATE_UNIVERSE } from './candidateBuilder.js';
import { scoreAndRankCandidates } from '../src/utils/opportunityScoringCore.js';
import { getUsUniverse } from './usUniverse.js';
import { selectDeepPool } from './preScreen.js';
import { confirmConviction, isConvictionAiEnabled } from './convictionAnalysis.js';
import { runEventWatch, getWatchPlan } from './eventWatch.js';
import { NEAR_MISS_THRESHOLD } from '../src/utils/conviction.js';
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

/**
 * Fiyat + kur çeker, Supabase'e yazar ve HAM quote nesnelerini döndürür.
 * Ham quote'lar olay nöbetine verilir: hacim patlaması ve 52 hafta kırılımı
 * gibi taze sinyaller ikinci bir ağ çağrısı yapılmadan oradan hesaplanır.
 */
async function collectQuotes(symbols) {
  const rawMap = new Map();
  const chunks = [];
  const all = [...symbols, ...FX_SYMBOLS];
  for (let i = 0; i < all.length; i += 200) chunks.push(all.slice(i, i + 200));

  const raw = [];
  for (const chunk of chunks) {
    const results = await yahooFinance.quote(chunk);
    for (const q of Array.isArray(results) ? results : [results]) {
      raw.push(q);
      rawMap.set(q.symbol, q);
    }
  }
  const list = raw.map(mapQuote);

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
  return rawMap;
}

/**
 * Haber toplama.
 *
 * `translateFor`: yalnızca bu sembollerin başlıkları Türkçeye çevrilir.
 * Nöbet listesi ~100 sembole çıktığı için hepsini çevirmek turu gereksiz
 * uzatırdı; kullanıcının kendi sembolleri anında çevrilir, vitrindekiler aday
 * turundaki enrichGatedTitles adımında toparlanır.
 */
async function collectNews(symbols, { translateFor = new Set() } = {}) {
  let total = 0;
  await mapLimit(symbols, 5, async (symbol) => {
    try {
      const articles = await fetchNewsForSymbolRaw(yahooFinance, symbol);
      if (articles.length === 0) return;

      // Yalnızca veritabanında olmayan makaleler işlenir
      const existing = await sb(
        `news?symbol=eq.${encodeURIComponent(symbol)}&select=id`
      );
      const known = new Set(existing.map((r) => r.id));
      const unseen = articles.filter((a) => !known.has(a.id));
      const fresh = translateFor.has(symbol) ? await addTurkishTitles(unseen, symbol) : unseen;
      if (fresh.length === 0) return;

      await sb('news', {
        method: 'POST',
        body: fresh.map((a) => {
          // Duygu + güvenilirlik kural motorundan gelir (ücretsiz, anında).
          // TÜM satırlar AYNI anahtar kümesine sahip olmalı; aksi halde PostgREST
          // toplu insert'i "All object keys must match" (PGRST102) ile reddeder.
          const signals = buildNewsSignals({ title: a.titleTr || a.title, publisher: a.publisher });
          return {
            id: a.id,
            symbol: a.symbol,
            title: a.title,
            title_tr: a.titleTr ?? null,
            publisher: a.publisher,
            link: a.link,
            published_at: a.publishedAt,
            sentiment: signals.sentiment,
            reliability: signals.reliability,
          };
        }),
        prefer: 'resolution=ignore-duplicates', // eski haberler korunur, yeniler eklenir
      });
      total += fresh.length;
    } catch (err) {
      console.error(`[news] ${symbol}: ${err.message}`);
    }
  });
  console.log(`Haber: ${symbols.length} sembol tarandı, ${total} yeni makale eklendi.`);
}

/**
 * Sinyalsiz (sentiment NULL) eski haberleri kural motoruyla doldurur.
 *
 * Eskiden bu adım her satırı Haiku'ya gönderiyordu ve maliyetin ana kaynağıydı:
 * tüm ABD taraması haber tablosunu sürekli beslediği için kuyruk hiç boşalmıyor,
 * 20 dakikada bir 50 makale ücretli olarak analiz ediliyordu. Artık işlem yerel
 * ve ücretsiz olduğu için parti çok daha büyük tutulabiliyor; arşiv birkaç turda
 * kapanır ve sonra bu adım hiçbir şey yapmaz.
 */
async function backfillNewsSignals(limit = 400) {
  const rows = await sb(
    `news?sentiment=is.null&select=id,title,title_tr,publisher&order=published_at.desc.nullslast&limit=${limit}`
  );
  if (!rows?.length) return;

  let updated = 0;
  await mapLimit(rows, 6, async (r) => {
    const signals = buildNewsSignals({ title: r.title_tr || r.title, publisher: r.publisher });
    try {
      await sb(`news?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', body: signals });
      updated++;
    } catch (err) {
      console.error(`[backfill] ${r.id}: ${err.message}`);
    }
  });
  console.log(`Backfill: ${updated}/${rows.length} eski haberin sinyalleri dolduruldu.`);
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
/** Başlık çevirisi + kesinlik (AI) turuna girecek vitrin adayı sayısı (her vade).
 *  Tüm derin havuza değil yalnızca vitrindeki ilk 30+30'a uygulanır; bu, hem
 *  çeviri trafiğini hem de tek AI kaleminin maliyetini sabit tutar. */
const GATED_TOP = 30;

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
 * Sembollerin haberlerini RSS'ten çekip YALNIZCA yeni makaleleri kaydeder.
 * Çeviri yapılmaz (o, vitrindeki sembollere enrichGatedTitles'ta uygulanır);
 * duygu/güvenilirlik kural motorundan geldiği için burada ücretsiz doldurulur.
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
          ...buildNewsSignals({ title: a.title, publisher: a.publisher }),
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
 * Vitrindeki (gated) ABD sembollerinin başlıklarını Türkçeye çevirir.
 *
 * Çeviri ücretsiz gtx ucundan yapılır ve YALNIZCA vitrine giren sembollere
 * uygulanır: 300 sembolün tamamını çevirmek gereksiz trafik olurdu, kullanıcı
 * zaten yalnızca listeye çıkan adayların haberlerini okuyor. Türkçe başlık aynı
 * zamanda kural motorunun ton tespitini de iyileştirir (çift dilli kalıplar).
 */
async function enrichGatedTitles(symbols) {
  const usSymbols = symbols.filter((s) => !s.endsWith('.IS')); // BIST başlıkları zaten Türkçe
  if (!usSymbols.length) return;

  let updated = 0;
  await mapLimit(usSymbols, 4, async (symbol) => {
    let rows;
    try {
      rows = await sb(
        `news?symbol=eq.${encodeURIComponent(symbol)}&title_tr=is.null&select=id,title,publisher&order=published_at.desc.nullslast&limit=8`
      );
    } catch {
      return;
    }
    if (!rows?.length) return;

    const withTr = await addTurkishTitles(
      rows.map((r) => ({ id: r.id, title: r.title })),
      symbol
    );
    for (const a of withTr) {
      if (!a.titleTr) continue;
      const publisher = rows.find((r) => r.id === a.id)?.publisher;
      try {
        // Başlık Türkçeleşince ton yeniden ölçülür — çeviri sonrası kalıplar
        // (ör. "hedef fiyatı yükseltti") daha iyi eşleşir.
        await sb(`news?id=eq.${encodeURIComponent(a.id)}`, {
          method: 'PATCH',
          body: { title_tr: a.titleTr, ...buildNewsSignals({ title: a.titleTr, publisher }) },
        });
        updated++;
      } catch {}
    }
  });
  console.log(`Gated başlık çevirisi: ${usSymbols.length} sembolde ${updated} başlık çevrildi.`);
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
  // Çeviri yalnızca vitrindeki ilk 30+30'a (deep havuzun tamamına değil).
  const gatedSet = [
    ...new Set([
      ...topYahooSymbols(lightRows, 'short', GATED_TOP, referenceMs),
      ...topYahooSymbols(lightRows, 'long', GATED_TOP, referenceMs),
    ]),
  ];
  console.log(`Faz 2 bitti: ${deepSet.length} sembol derin analiz, ${gatedSet.length} sembol vitrin.`);

  // --- FAZ 3: derin analiz + YAZ ---
  // Aday yazımı ağ bağımlı zenginleştirmelerden ÖNCE yapılır; böylece tur en
  // sondaki adımlarda takılsa bile vitrin güncellenmiş olur. Başlık çevirisi en
  // sonda "olabildiğince" çalışır (Haber sayfası + sonraki turun kartları için).
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

  // --- Kesinlik teyidi (turun TEK AI adımı) ---
  // Yalnızca kanıtı eşiğe yakın olan finalistlere uygulanır; AI kesinliği
  // yalnızca AŞAĞI çekebildiği için bu adım atlanırsa (anahtar yok, hata,
  // zaman aşımı) vitrin kural skorlarıyla çalışmaya devam eder.
  try {
    await confirmFinalists(deepRows);
  } catch (err) {
    console.error(`[kesinlik] adım atlandı: ${err.message}`);
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

  // --- Başlık çevirisi (en sonda, OLABİLDİĞİNCE) ---
  // Adaylar zaten yazıldı; bu adım yavaş olsa/timeout'a düşse bile vitrin etkilenmez.
  // Vitrindeki ilk 30+30'un başlıklarını Türkçeleştirir → Haber sayfası ve BİR
  // SONRAKİ turun kartları için.
  try {
    await enrichGatedTitles(gatedSet);
  } catch (err) {
    console.error(`[enrich] adım atlandı: ${err.message}`);
  }
}

/**
 * Kanıtı eşiğe yakın olan adayları AI teyidinden geçirir.
 *
 * Aynı sembolün kısa ve uzun vade adayları AYNI conviction nesnesini paylaşır
 * (buildCandidatePair tek nesne üretip ikisine de koyar), bu yüzden AI sembol
 * başına BİR kez çalışır ve sonuç iki satıra da yazılır — aynı kanıt için iki
 * kez ödeme yapılmaz.
 */
async function confirmFinalists(rows) {
  if (!isConvictionAiEnabled()) {
    console.log('Kesinlik teyidi: ANTHROPIC_API_KEY yok, kural skorlarıyla devam ediliyor.');
    return;
  }

  const bySymbol = new Map();
  for (const r of rows) {
    const c = r.data?.conviction;
    if (!c || c.score < NEAR_MISS_THRESHOLD || !c.evidence?.length) continue;
    if (!bySymbol.has(r.symbol)) {
      bySymbol.set(r.symbol, {
        symbol: r.data.symbol,
        companyName: r.data.companyName,
        sector: r.data.sector,
        conviction: c,
        rows: [],
      });
    }
    bySymbol.get(r.symbol).rows.push(r);
  }

  const finalists = [...bySymbol.values()].sort((a, b) => b.conviction.score - a.conviction.score);
  if (finalists.length === 0) {
    console.log('Kesinlik teyidi: eşiğe yakın aday yok, AI çağrısı yapılmadı.');
    return;
  }

  await confirmConviction(finalists);

  // Teyit edilmiş kesinliği o sembolün tüm aday satırlarına yaz
  for (const f of finalists) {
    for (const r of f.rows) r.data.conviction = f.conviction;
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

// COLLECT_MODE ile iş ikiye ayrılır — AYRIM HIZ ÜZERİNEDİR:
//   'data' (varsayılan, 20 dk): fiyat + kur + TAZE HABER + olay nöbeti. Hızlı
//                 değişen her şey burada. Vitrindeki adayların kanıtı bu turda
//                 tazelenir; yeni bir olay 6 saat değil ~20 dakika içinde görünür.
//   'candidates' (6 saat): evren taraması + 2 yıllık grafik + temel veriler.
//                 Yavaş değişen, pahalı iş. Sık koşulamaz, koşması da gerekmez.
const MODE = process.env.COLLECT_MODE || 'data';
const symbols = await getTrackedSymbols();

if (MODE === 'candidates') {
  console.log(`Mod: ${MODE} | ${symbols.length} sembol izleniyor`);
  await collectCandidates(symbols);
} else {
  // Nöbet planı: değerlendirme tüm vitrine, haber çekimi önceliklendirilmiş alt kümeye
  const plan = await getWatchPlan(sb, symbols);
  console.log(
    `Mod: ${MODE} | nöbet: ${plan.evaluate.length} sembol değerlendirilecek, ` +
      `${plan.fetch.length} sembolün haberi çekilecek (${symbols.length} izlenen her turda)`
  );

  const quoteMap = await collectQuotes(plan.evaluate);
  await collectNews(plan.fetch, { translateFor: new Set(symbols) });

  // Sinyalsiz eski haberleri kural motoruyla doldur (ücretsiz; izole)
  try {
    await backfillNewsSignals();
  } catch (err) {
    console.error(`[backfill] adım atlandı: ${err.message}`);
  }

  // Olay nöbeti: taze haberle kanıtı yeniden değerlendir (izole — hata olsa da
  // fiyat/haber toplama başarılı sayılır)
  try {
    await runEventWatch({ sb, quoteMap, getNewsForSymbol });
  } catch (err) {
    console.error(`[nöbet] adım atlandı: ${err.message}`);
  }
}
console.log('Toplama tamamlandı.');

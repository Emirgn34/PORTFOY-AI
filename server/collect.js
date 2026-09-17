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
import { CONVICTION_THRESHOLD } from '../src/utils/conviction.js';
import { mapLimit } from './concurrency.js';
import { buildEvidenceSignature } from './aiControl.js';
import {
  assessGenerationCompleteness,
  selectMarketBalancedSymbols,
} from './candidateSelection.js';
import {
  MODEL_PORTFOLIO_PROFILES,
  buildModelPortfolios,
  getModelPortfolioProfileScore,
  isModelPortfolioCandidateEligible,
} from '../src/utils/modelPortfolioCore.js';
import { assessMonthlyConsensusCoverage } from '../src/utils/modelPortfolioConsensus.js';
import {
  MODEL_PORTFOLIO_BENCHMARKS,
  calculateModelPortfolioSnapshot,
  toModelPortfolioMarketSymbol,
} from '../src/utils/modelPortfolioPerformance.js';

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

function isMissingRelationError(error) {
  return /\b(?:PGRST205|42P01)\b/.test(String(error?.message ?? ''));
}

async function getTrackedSymbols() {
  // Bu tablo ortak tarama girdisidir; hatalı/şişirilmiş kayıtların tüm işi
  // sınırsız büyütmesine izin verme. DB politikası da yalnız authenticated yazıma açıktır.
  let rows;
  try {
    // Sahiplik nedeniyle aynı sembol tabloda birden çok kez bulunabilir; bu
    // service-only view LIMIT uygulanmadan önce sembolleri tekilleştirir.
    rows = await sb('tracked_symbol_queue?select=symbol&order=symbol.asc&limit=500');
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    // Migration henüz uygulanmamış eski kurulum uyumluluğu.
    rows = await sb('tracked_symbols?select=symbol&order=symbol.asc&limit=1000');
  }
  const symbols = [
    ...new Set(
      (rows ?? [])
        .map((row) => String(row.symbol ?? '').trim().toUpperCase())
        .filter((symbol) => /^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol))
    ),
  ].slice(0, 500);
  if (symbols.length > 0) {
    if ((rows?.length ?? 0) !== symbols.length) {
      console.warn(`[tracked] ${rows?.length ?? 0} kayıttan güvenli sınırlar içindeki ${symbols.length} sembol kullanılacak.`);
    }
    return symbols;
  }

  console.log('İzleme tablosu boş; varsayılan semboller ekleniyor...');
  await sb('tracked_symbols', {
    method: 'POST',
    body: DEFAULT_SYMBOLS.map((symbol) => ({ symbol })),
    prefer: 'resolution=ignore-duplicates,missing=default',
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
/** Her vade için derin analiz + araştırma havuzu (pazar dengeli ilk 100). */
const DISPLAY_BUFFER = 100;
/** Başlık çevirisi + kesinlik (AI) turuna girecek vitrin adayı sayısı (her vade).
 *  Tüm derin havuza değil yalnızca vitrindeki ilk 50+50'ye uygulanır; bu, hem
 *  çeviri trafiğini hem de tek AI kaleminin maliyetini sabit tutar. */
const GATED_TOP = 50;
/** Derin/vitrin havuzunda BIST payı; kalan kontenjan ABD içindir. */
const BIST_CANDIDATE_SHARE = 0.45;
/** Kullanıcı kuyruğunun ortak ağır taramayı ve sistematik sepeti ele geçirmesini önler. */
const OPTIONAL_TRACKED_DEEP_LIMIT = 50;

function generationCoverageIsSafe(label, plannedSymbols, completedRows) {
  const coverage = assessGenerationCompleteness(plannedSymbols, completedRows);
  if (coverage.ok) return true;
  const details = coverage.markets
    .map((item) => `${item.market} ${item.actual}/${item.expected}`)
    .join(', ');
  console.error(
    `[candidates] ${label} eksik: ${coverage.actual}/${coverage.expected} ` +
      `(%${Math.round(coverage.ratio * 100)}), ${details}. Önceki jenerasyon korunuyor.`
  );
  return false;
}

/** Sürüm tablosu uygulanmamış eski kurulumlarda null döner. */
async function getActiveModelPortfolioVersions(at = new Date().toISOString()) {
  try {
    return await sb(
      `model_portfolio_versions?status=eq.active&cycle_end=gt.${encodeURIComponent(at)}` +
        '&select=version_key,slug,risk_tier,source_generation,cycle_start,cycle_end,data' +
        '&order=risk_tier.asc'
    );
  } catch (err) {
    if (isMissingRelationError(err)) return null;
    throw err;
  }
}

/** En son yayımlanmış dört portföyü carry-over kararları için getirir. */
async function getLatestModelPortfolioVersionSet() {
  try {
    const rows = await sb(
      'model_portfolio_versions?' +
        'select=version_key,slug,risk_tier,cycle_start,cycle_end,status,data' +
        '&order=cycle_start.desc,risk_tier.asc&limit=12'
    );
    if (!rows?.length) return [];
    const latestStart = rows[0].cycle_start;
    const latest = rows.filter((row) => row.cycle_start === latestStart);
    assertCompleteModelPortfolioSet(latest, 'En son aylık sürüm kümesi');
    return latest;
  } catch (err) {
    if (isMissingRelationError(err)) return [];
    throw err;
  }
}

/** Sürüm tablosu boş/eski kurulumdaysa current pointer'dan son sepetleri okur. */
async function getLatestModelPortfolioData() {
  const versions = await getLatestModelPortfolioVersionSet();
  if (versions.length) return versions.map((row) => row.data).filter(Boolean);
  try {
    const rows = await sb(
      'model_portfolios?select=slug,risk_tier,data&order=risk_tier.asc&limit=4'
    );
    if (rows?.length) assertCompleteModelPortfolioSet(rows, 'Güncel model portföy işaretçileri');
    return (rows ?? []).map((row) => row.data).filter(Boolean);
  } catch (err) {
    if (isMissingRelationError(err)) return [];
    throw err;
  }
}

/** Son 30 günlük 6 saatlik analiz özetlerini PostgREST limitine takılmadan okur. */
async function getCandidateAnalysisHistory(at, days = 30) {
  const until = new Date(at).toISOString();
  const since = new Date(new Date(at).getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const pageSize = 1000;
  // 500 geçerli kullanıcı sembolü + zorunlu havuz, iki vade ve günde dört
  // taramada 100 bin satırı aşabilir. Eksik konsensüs üretmeden bu gerçekçi
  // üst sınıra kadar sayfala; olağandış büyümede yine fail-closed davran.
  const maximumRows = 250_000;
  const rows = [];
  try {
    for (let offset = 0; offset < maximumRows; offset += pageSize) {
      const page = await sb(
        `candidate_analysis_snapshots?captured_at=gte.${encodeURIComponent(since)}` +
          `&captured_at=lte.${encodeURIComponent(until)}` +
          '&select=generation,source_symbol,symbol,horizon,captured_at,market,opportunity_score,rank,' +
          'profile_scores,eligibility,factor_scores,risk_level,liquidity_level,' +
          'expected_return_pct,conviction_rule_score,conviction_score,ai_used,ai_cache_hit,' +
          'ai_certainty,evidence_signature,analysis_depth' +
          '&order=captured_at.asc,generation.asc,source_symbol.asc,horizon.asc' +
          `&limit=${pageSize}&offset=${offset}`
      );
      rows.push(...(page ?? []));
      if ((page?.length ?? 0) < pageSize) break;
      if (offset + pageSize >= maximumRows) {
        throw new Error(
          `[candidate-history] ${maximumRows} satır güvenlik sınırı aşıldı; eksik konsensüs üretilmedi.`
        );
      }
    }
    return rows;
  } catch (err) {
    if (isMissingRelationError(err)) return null;
    throw err;
  }
}

/**
 * Tek bir aday jenerasyonunu PostgREST'in varsayılan 1000 satır sınırına
 * takılmadan, kararlı bir bileşik sırayla eksiksiz okur.
 */
async function getCandidateGenerationRows(generation) {
  const pageSize = 1000;
  const maximumRows = 100_000;
  const rows = [];
  for (let offset = 0; offset < maximumRows; offset += pageSize) {
    const page = await sb(
      `candidates?generation=eq.${generation}` +
        '&select=symbol,horizon,market,data' +
        '&order=horizon.asc,symbol.asc' +
        `&limit=${pageSize}&offset=${offset}`
    );
    rows.push(...(page ?? []));
    if ((page?.length ?? 0) < pageSize) return rows;
  }
  throw new Error(
    `[candidates] jenerasyon ${generation} için ${maximumRows} satır güvenlik sınırı aşıldı.`
  );
}

function currentPortfolioRows(portfolios, updatedAt) {
  return portfolios.map((portfolio) => ({
    slug: portfolio.slug,
    risk_tier: portfolio.riskTier,
    source_generation: portfolio.sourceGeneration,
    generated_at: portfolio.generatedAt,
    valid_until: portfolio.dataFreshUntil ?? portfolio.validUntil,
    data: portfolio,
    updated_at: updatedAt,
  }));
}

function assertCompleteModelPortfolioSet(rows, label) {
  const expectedSlugs = MODEL_PORTFOLIO_PROFILES.map((profile) => profile.slug).sort();
  const actualSlugs = (rows ?? [])
    .map((row) => row?.slug ?? row?.data?.slug)
    .filter(Boolean)
    .sort();
  const riskTiers = (rows ?? [])
    .map((row) => Number(row?.risk_tier ?? row?.riskTier ?? row?.data?.riskTier))
    .filter(Number.isFinite);
  const complete =
    rows?.length === expectedSlugs.length &&
    new Set(actualSlugs).size === expectedSlugs.length &&
    expectedSlugs.every((slug, index) => actualSlugs[index] === slug) &&
    new Set(riskTiers).size === expectedSlugs.length;
  if (!complete) {
    throw new Error(
      `${label}: dört benzersiz profil doğrulanamadı ` +
        `(satır=${rows?.length ?? 0}, slug=${actualSlugs.join(',') || 'yok'}).`
    );
  }
}

function assertIncumbentAnalysisCoverage(previousPortfolios, candidateRows) {
  if (!previousPortfolios?.length) return;
  const available = new Set(
    (candidateRows ?? [])
      .filter((row) => row?.data?.analysisDepth === 'deep')
      .map((row) => `${String(row.symbol).toUpperCase()}:${row.horizon}`)
  );
  const missing = [];
  for (const portfolio of previousPortfolios) {
    const horizon = portfolio?.horizon;
    if (!horizon) continue;
    for (const holding of portfolio?.holdings ?? []) {
      const symbol = String(
        holding?.sourceSymbol ??
          holding?.source_symbol ??
          toModelPortfolioMarketSymbol(holding)
      )
        .trim()
        .toUpperCase();
      if (symbol && !available.has(`${symbol}:${horizon}`)) {
        missing.push(`${symbol}/${horizon}`);
      }
    }
  }
  if (missing.length) {
    throw new Error(
      `Önceki dönem hisselerinin güncel derin analizi eksik: ${[...new Set(missing)].join(', ')}. ` +
        'Eksik veri zorunlu satış sayılmadı; yeni dönem açılmadı.'
    );
  }
}

/** Dönem başı holding, kur ve benchmark fiyatlarını aynı anda sabitler. */
async function getModelPortfolioTrackingBaseline(startedAt, portfolios) {
  const requiredCurrencies = new Set([
    ...MODEL_PORTFOLIO_BENCHMARKS.map((benchmark) => benchmark.currency),
    ...(portfolios ?? []).flatMap((portfolio) =>
      (portfolio?.holdings ?? []).map((holding) => holding.currency)
    ),
  ].map((currency) => String(currency ?? '').toUpperCase()));
  const requiredFxSymbols = FX_SYMBOLS.filter((symbol) =>
    requiredCurrencies.has(String(symbol).slice(0, 3))
  );
  const holdingSymbols = [
    ...new Set(
      (portfolios ?? []).flatMap((portfolio) =>
        (portfolio?.holdings ?? []).map(toModelPortfolioMarketSymbol).filter(Boolean)
      )
    ),
  ];
  const symbols = [
    ...holdingSymbols,
    ...MODEL_PORTFOLIO_BENCHMARKS.map((benchmark) => benchmark.symbol),
    ...FX_SYMBOLS,
  ];
  try {
    const response = await yahooFinance.quote([...new Set(symbols)]);
    const quotes = (Array.isArray(response) ? response : [response]).map(mapQuote);
    const bySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
    const baseFxByCurrency = {
      TRY: 1,
      USD: bySymbol.get('USDTRY=X')?.price ?? null,
      EUR: bySymbol.get('EURTRY=X')?.price ?? null,
    };
    const benchmarkBaselines = Object.fromEntries(
      MODEL_PORTFOLIO_BENCHMARKS.map((benchmark) => [
        benchmark.key,
        {
          symbol: benchmark.symbol,
          label: benchmark.label,
          currency: benchmark.currency,
          price: bySymbol.get(benchmark.symbol)?.price ?? null,
        },
      ])
    );
    const missing = [
      ...holdingSymbols.filter((symbol) => !(Number(bySymbol.get(symbol)?.price) > 0)),
      ...requiredFxSymbols.filter((symbol) => !(Number(bySymbol.get(symbol)?.price) > 0)),
      ...MODEL_PORTFOLIO_BENCHMARKS
        .map((benchmark) => benchmark.symbol)
        .filter((symbol) => !(Number(bySymbol.get(symbol)?.price) > 0)),
    ];
    if (missing.length) {
      throw new Error(`başlangıç fiyatı eksik: ${[...new Set(missing)].join(', ')}`);
    }
    return {
      tracking: {
        baseCurrency: 'TRY',
        startedAt,
        performanceMethodVersion: 'fixed-weight-tl-price-return-split-adjusted-v2',
        baseFxByCurrency,
        benchmarkBaselines,
      },
      holdingPriceBySymbol: Object.fromEntries(
        holdingSymbols.map((symbol) => [symbol, bySymbol.get(symbol).price])
      ),
    };
  } catch (err) {
    throw new Error(`Dönem başlangıç bazları alınamadı: ${err.message}`);
  }
}

function applyModelPortfolioTrackingBaseline(portfolios, baseline) {
  return portfolios.map((portfolio) => ({
    ...portfolio,
    tracking: baseline.tracking,
    holdings: portfolio.holdings.map((holding) => {
      const symbol = toModelPortfolioMarketSymbol(holding);
      const price = Number(baseline.holdingPriceBySymbol[symbol]);
      return Number.isFinite(price) && price > 0
        ? { ...holding, currentPriceAtGeneration: price }
        : holding;
    }),
  }));
}

/**
 * Yeniden dengeleme anında eski sepeti ve yeni sepetin başlangıcını aynı
 * fiyat/kur/benchmark fotoğrafına bağlar. Böylece planlanan vade sonu ile
 * sonraki 6 saatlik karar turu arasındaki piyasa hareketi zincirden kaybolmaz.
 */
function buildPreviousModelPortfolioClosingRows(
  portfolios,
  baseline,
  observedAt,
  splitFactorBySymbol = {}
) {
  const tracked = (portfolios ?? []).filter(
    (portfolio) => portfolio?.versionKey && portfolio?.tracking
  );
  if (!tracked.length) return [];
  const priceBySymbol = baseline.holdingPriceBySymbol;
  const fxByCurrency = baseline.tracking.baseFxByCurrency;
  const benchmarkPriceByKey = Object.fromEntries(
    Object.entries(baseline.tracking.benchmarkBaselines ?? {}).map(([key, value]) => [
      key,
      value?.price ?? null,
    ])
  );
  const navDate = istanbulDate(new Date(observedAt));
  const rows = tracked.map((portfolio) => {
    const snapshot = calculateModelPortfolioSnapshot(portfolio, {
      priceBySymbol,
      fxByCurrency,
      benchmarkPriceByKey,
      splitFactorBySymbol,
    });
    if (!snapshot || snapshot.coveragePct < 99.99) {
      throw new Error(
        `Eski dönem ${portfolio.slug} kapanış değerlemesi eksik ` +
          `(${snapshot?.coveragePct ?? 0}%). Yeni dönem açılmadı.`
      );
    }
    return {
      version_key: portfolio.versionKey,
      nav_date: navDate,
      observed_at: observedAt,
      nav_value: snapshot.navValue,
      return_pct: snapshot.returnPct,
      coverage_pct: snapshot.coveragePct,
      benchmarks: snapshot.benchmarks,
    };
  });
  return rows;
}

function istanbulDate(instant = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

function istanbulHour(instant = new Date()) {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(instant)
    .find((part) => part.type === 'hour')?.value;
  const numeric = Number(hour);
  return Number.isFinite(numeric) ? numeric : null;
}

function splitRatio(event) {
  const numerator = Number(event?.numerator);
  const denominator = Number(event?.denominator);
  if (Number.isFinite(numerator) && numerator > 0 && Number.isFinite(denominator) && denominator > 0) {
    return numerator / denominator;
  }
  const [rawNumerator, rawDenominator] = String(event?.splitRatio ?? '').split(/[:/]/);
  const parsedNumerator = Number(rawNumerator);
  const parsedDenominator = Number(rawDenominator);
  return Number.isFinite(parsedNumerator) && parsedNumerator > 0 &&
    Number.isFinite(parsedDenominator) && parsedDenominator > 0
    ? parsedNumerator / parsedDenominator
    : null;
}

/**
 * Her sembol için dönem başlangıcından beri gerçekleşen split/ters-split
 * çarpanını Yahoo corporate-action olaylarından üretir. Tek bir sembolün
 * geçmişi okunamazsa yanlış NAV yayımlamak yerine tüm değerleme fail-closed olur.
 */
async function getModelPortfolioSplitFactors(portfolios, observedAt) {
  const observedMs = new Date(observedAt).getTime();
  if (!Number.isFinite(observedMs)) throw new Error('split değerleme zamanı geçersiz');
  const startBySymbol = new Map();
  for (const portfolio of portfolios ?? []) {
    const startedAt =
      portfolio?.tracking?.startedAt ?? portfolio?.cycleStart ?? portfolio?.generatedAt;
    const startedMs = new Date(startedAt).getTime();
    if (!Number.isFinite(startedMs)) continue;
    for (const holding of portfolio?.holdings ?? []) {
      const symbol = toModelPortfolioMarketSymbol(holding);
      if (!symbol) continue;
      const previous = startBySymbol.get(symbol);
      if (previous == null || startedMs < previous) startBySymbol.set(symbol, startedMs);
    }
  }
  const entries = [...startBySymbol.entries()];
  const factors = {};
  await mapLimit(entries, 5, async ([symbol, startedMs]) => {
    let result = null;
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        result = await yahooFinance.chart(symbol, {
          period1: new Date(startedMs - 24 * 60 * 60 * 1000),
          period2: new Date(observedMs + 5 * 60 * 1000),
          interval: '1d',
          events: 'split',
        });
        break;
      } catch (err) {
        lastError = err;
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        }
      }
    }
    if (!result) {
      throw new Error(`${symbol} split geçmişi alınamadı: ${lastError?.message ?? 'bilinmeyen hata'}`);
    }
    let factor = 1;
    const rawSplits = result.events?.splits;
    const splitEvents = Array.isArray(rawSplits)
      ? rawSplits
      : rawSplits && typeof rawSplits === 'object'
        ? Object.values(rawSplits)
        : [];
    for (const event of splitEvents) {
      const rawEventTime = event?.date;
      const eventMs =
        typeof rawEventTime === 'number' && rawEventTime > 0 && rawEventTime < 100_000_000_000
          ? rawEventTime * 1000
          : new Date(rawEventTime).getTime();
      const ratio = splitRatio(event);
      if (
        Number.isFinite(eventMs) &&
        eventMs > startedMs &&
        eventMs <= observedMs &&
        ratio != null
      ) {
        factor *= ratio;
      }
    }
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(`${symbol} için split çarpanı geçersiz`);
    }
    factors[symbol] = factor;
  });
  return factors;
}

/** 20 dakikalık veri turlarından İstanbul 02:00 sonrası ilk tam noktayı günlük NAV'a yazar. */
async function snapshotModelPortfolioPerformance(versions, quoteMap) {
  if (!versions?.length) return;
  const observedAt = new Date().toISOString();
  const observedInstant = new Date(observedAt);
  const navDate = istanbulDate(observedInstant);
  // ABD kapanışını (kış saati dahil) gördükten sonra günde tek resmi nokta
  // üret. İlk/eksik deneme başarısızsa sonraki 20 dakikalık tur tekrar dener.
  if ((istanbulHour(observedInstant) ?? 0) < 2) return;
  const existingRows = await sb(
    `model_portfolio_nav?nav_date=eq.${navDate}&select=version_key`
  );
  const existingVersionKeys = new Set((existingRows ?? []).map((row) => row.version_key));
  if (versions.every((version) => existingVersionKeys.has(version.version_key))) return;

  const priceBySymbol = {};
  for (const [symbol, rawQuote] of quoteMap) {
    priceBySymbol[symbol] = mapQuote(rawQuote).price;
  }
  const fxByCurrency = {
    TRY: 1,
    USD: priceBySymbol['USDTRY=X'] ?? null,
    EUR: priceBySymbol['EURTRY=X'] ?? null,
  };
  const benchmarkPriceByKey = Object.fromEntries(
    MODEL_PORTFOLIO_BENCHMARKS.map((benchmark) => [
      benchmark.key,
      priceBySymbol[benchmark.symbol] ?? null,
    ])
  );
  const observedMs = new Date(observedAt).getTime();
  const splitFactorBySymbol = await getModelPortfolioSplitFactors(
    versions.map((version) => version.data),
    observedAt
  );
  const rows = [];

  for (const version of versions) {
    const cycleStartMs = new Date(version.cycle_start).getTime();
    const cycleEndMs = new Date(version.cycle_end).getTime();
    if (
      !Number.isFinite(cycleStartMs) ||
      !Number.isFinite(cycleEndMs) ||
      observedMs < cycleStartMs ||
      observedMs >= cycleEndMs
    ) {
      continue;
    }
    const portfolio = version.data;
    const snapshot = calculateModelPortfolioSnapshot(portfolio, {
      priceBySymbol,
      fxByCurrency,
      benchmarkPriceByKey,
      splitFactorBySymbol,
    });
    if (!snapshot || snapshot.coveragePct < 99.99) {
      console.warn(
        `[model-portfolios] ${version.slug} değerlemesi eksik kapsam nedeniyle atlandı ` +
          `(${snapshot?.coveragePct ?? 0}%).`
      );
      continue;
    }
    rows.push({
      version_key: version.version_key,
      nav_date: navDate,
      observed_at: observedAt,
      nav_value: snapshot.navValue,
      return_pct: snapshot.returnPct,
      coverage_pct: snapshot.coveragePct,
      benchmarks: snapshot.benchmarks,
    });
  }

  if (!rows.length) return;
  await sb('model_portfolio_nav', {
    method: 'POST',
    body: rows,
    prefer: 'resolution=merge-duplicates',
  });
  console.log(`Model portföy takibi: ${rows.length} günlük NAV noktası güncellendi.`);
}

/** Büyük sembol listesini parçalara bölerek toplu quote çeker (ham quote nesneleri). */
async function fetchQuotesChunked(symbols, chunkSize = 200, concurrency = 3) {
  const chunks = [];
  for (let i = 0; i < symbols.length; i += chunkSize) chunks.push(symbols.slice(i, i + chunkSize));
  const map = new Map();
  await mapLimit(chunks, concurrency, async (chunk, idx) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await yahooFinance.quote(chunk);
        for (const q of Array.isArray(res) ? res : [res]) map.set(q.symbol, q);
        return;
      } catch (err) {
        if (attempt === 3) {
          console.error(`[quotes] parça ${idx}, 3 deneme başarısız: ${err.message}`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
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

/**
 * 3 fazlı fırsat üretimi:
 *   Faz 1 — tüm ABD evreni → ucuz ön-skor → en iyi 300
 *   Faz 2 — 300 (+BIST/çekirdek) → hafif analiz (2yıl YOK) + ham haber → ön sıralama
 *   Faz 3 — her vadede pazar dengeli ilk 100 → 2 yıllık ZORUNLU analiz + gated AI haber → yaz
 */
async function collectCandidates(trackedSymbols) {
  const referenceMs = Date.now();

  // --- FAZ 1 ---
  const usUniverse = await getUsUniverse(sb);
  const latestModelPortfolios = await getLatestModelPortfolioData();
  const incumbentSymbols = latestModelPortfolios.flatMap((portfolio) =>
    (portfolio?.holdings ?? [])
      .map((holding) =>
        String(
          holding?.sourceSymbol ??
            holding?.source_symbol ??
            toModelPortfolioMarketSymbol(holding)
        )
          .trim()
          .toUpperCase()
      )
      .filter(Boolean)
  );
  // Son yayımlanan aylık portföy hisseleri, dönem tam bu turda dolmuş olsa bile
  // carry-over kararından önce yeniden derin analiz edilir. Genel ön elemede geriye
  // düşmeleri onları görünmez yapamaz.
  const mandatoryCore = [...new Set([...CANDIDATE_UNIVERSE, ...incumbentSymbols])];
  const quoteSymbols = [...new Set([...usUniverse, ...mandatoryCore, ...trackedSymbols])];
  console.log(`Faz 1: ${quoteSymbols.length} sembol için toplu fiyat çekiliyor...`);
  const quoteMap = await fetchQuotesChunked(quoteSymbols);
  const validTrackedSymbols = trackedSymbols.filter((symbol) => {
    const rawQuote = quoteMap.get(symbol);
    if (!rawQuote) return false;
    const price = mapQuote(rawQuote).price;
    return Number.isFinite(Number(price)) && Number(price) > 0;
  });
  const rejectedTrackedCount = trackedSymbols.length - validTrackedSymbols.length;
  if (rejectedTrackedCount > 0) {
    console.warn(
      `[tracked] ${rejectedTrackedCount} sembol geçerli fiyat vermedi; zorunlu kapsamdan ve derin analizden çıkarıldı.`
    );
  }
  if (
    !generationCoverageIsSafe(
      'Faz 1 fiyat kapsamı',
      [...new Set([...usUniverse, ...mandatoryCore])],
      [...quoteMap.keys()].map((symbol) => ({ symbol }))
    )
  ) return;

  const usQuotes = usUniverse.map((s) => quoteMap.get(s)).filter(Boolean);
  const pool = selectDeepPool(usQuotes, { total: DEEP_POOL_SIZE });
  const mandatoryFaz2Symbols = [...new Set([...pool, ...mandatoryCore])];
  const optionalTrackedSymbols = validTrackedSymbols
    .filter((symbol) => !mandatoryFaz2Symbols.includes(symbol))
    .slice(0, OPTIONAL_TRACKED_DEEP_LIMIT);
  const faz2Symbols = [...new Set([...mandatoryFaz2Symbols, ...optionalTrackedSymbols])];
  console.log(
    `Faz 1 bitti: ${pool.length} ABD havuzu + ${mandatoryCore.length} zorunlu çekirdek/incumbent + ` +
      `${optionalTrackedSymbols.length} opsiyonel izlenen → ${faz2Symbols.length} sembol Faz 2'ye.`
  );

  // --- FAZ 2 ---
  const newAdded = await collectNewsRaw(faz2Symbols);
  console.log(`Faz 2: ${newAdded} yeni ham haber eklendi. Hafif analiz yapılıyor...`);
  const lightRows = await buildCandidates(faz2Symbols, { yahooFinance, getNewsForSymbol, deep: false, quoteMap });
  if (lightRows.length === 0) {
    console.log('Faz 2: aday üretilemedi.');
    return;
  }
  if (!generationCoverageIsSafe('Faz 2 hafif analiz kapsamı', mandatoryFaz2Symbols, lightRows)) return;
  const lightSymbols = new Set(lightRows.map((row) => row.symbol));
  const eligibleTracked = optionalTrackedSymbols.filter((symbol) => lightSymbols.has(symbol));
  const eligibleIncumbents = incumbentSymbols.filter((symbol) => lightSymbols.has(symbol));
  const optionalTrackedOnly = new Set(
    eligibleTracked.filter((symbol) => !mandatoryFaz2Symbols.includes(symbol))
  );
  const mandatoryLightRows = lightRows.filter((row) => !optionalTrackedOnly.has(row.symbol));
  const mandatoryDeepSet = [
    ...new Set([
      ...selectMarketBalancedSymbols(mandatoryLightRows, 'short', {
        total: DISPLAY_BUFFER,
        bistShare: BIST_CANDIDATE_SHARE,
        referenceMs,
      }),
      ...selectMarketBalancedSymbols(mandatoryLightRows, 'long', {
        total: DISPLAY_BUFFER,
        bistShare: BIST_CANDIDATE_SHARE,
        referenceMs,
      }),
      ...eligibleIncumbents,
    ]),
  ];
  const modelCandidateSymbols = new Set(mandatoryDeepSet);
  const officialModelRows = (rows) =>
    (rows ?? []).filter((row) => modelCandidateSymbols.has(row.symbol));
  const deepSet = [
    ...new Set([
      ...mandatoryDeepSet,
      // Geçerli fiyatı olan kullanıcı sembolleri puanı ne olursa olsun
      // denenir; başarısızlıkları zorunlu jenerasyonu bloke etmez.
      ...eligibleTracked,
    ]),
  ];
  // Çeviri yalnızca vitrindeki ilk 50+50'ye (deep havuzun tamamına değil).
  const gatedSet = [
    ...new Set([
      ...selectMarketBalancedSymbols(lightRows, 'short', {
        total: GATED_TOP,
        bistShare: BIST_CANDIDATE_SHARE,
        referenceMs,
      }),
      ...selectMarketBalancedSymbols(lightRows, 'long', {
        total: GATED_TOP,
        bistShare: BIST_CANDIDATE_SHARE,
        referenceMs,
      }),
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

  if (!generationCoverageIsSafe('Faz 3 derin analiz kapsamı', mandatoryDeepSet, deepRows)) return;

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

  // --- Önce deterministik jenerasyonu yayınla ---
  // Batch AI çağrısı 55 dakikaya kadar sürebilir. Adayları ondan önce yazarak
  // workflow sonradan zaman aşımına uğrasa bile yeni taramayı kaybetmeyiz.
  const generation = Date.now();
  const generatedAt = new Date(generation).toISOString();
  let effectiveRows = null;
  const candidatePayload = () =>
    deepRows.map((r) => ({
      symbol: r.symbol,
      horizon: r.horizon,
      market: r.market,
      data: r.data,
      generation,
      updated_at: generatedAt,
    }));
  await sb('candidates', {
    method: 'POST',
    body: candidatePayload(),
    prefer: 'resolution=merge-duplicates',
  });
  try {
    // Önceki turlardan kalan (veya jenerasyonsuz) satırları sil → liste bayatlamaz
    await sb(`candidates?or=(generation.is.null,generation.lt.${generation})`, { method: 'DELETE' });
  } catch (err) {
    console.error(`[candidates] bayat temizliği atlandı: ${err.message}`);
  }
  console.log(`Aday: ${deepRows.length / 2} sembol yazıldı (jenerasyon ${generation}).`);

  // Aynı aday jenerasyonundan dört risk seviyeli model sepet üret.
  // Adaylar 6 saatte bir yenilense de yayınlanmış sepet bir ay boyunca
  // değişmez. Süresi dolan sürüm kapanır ve ilk sonraki aday turu yeni dönemi
  // açar. Migration henüz uygulanmadıysa eski current-snapshot davranışı sürer.
  async function publishModelPortfolios() {
    const decisionAt = new Date().toISOString();
    const activeVersions = await getActiveModelPortfolioVersions(decisionAt);
    if (activeVersions?.length) {
      assertCompleteModelPortfolioSet(activeVersions, 'Aktif aylık sürüm kümesi');
      // Current pointer eksik/bozuksa aktif sürümlerden kendini iyileştir; sepet
      // içeriği ve dönem başlangıcı hiçbir şekilde yeniden üretilmez.
      await sb('model_portfolios', {
        method: 'POST',
        body: currentPortfolioRows(
          activeVersions.map((version) => version.data),
          decisionAt
        ),
        prefer: 'resolution=merge-duplicates',
      });
      console.log(
        `Model portföy: aktif aylık dönem ${activeVersions[0].cycle_start} tarihinden beri kilitli; yeni adaylar sonraki döneme ayrıldı.`
      );
      return;
    }

    const [rawAnalysisHistory, previousPortfolios] = await Promise.all([
      getCandidateAnalysisHistory(decisionAt),
      getLatestModelPortfolioData(),
    ]);
    const officialSourceSymbols = new Set(
      officialModelRows(effectiveRows).map((row) => String(row.symbol ?? '').trim().toUpperCase())
    );
    const analysisHistory = Array.isArray(rawAnalysisHistory)
      ? rawAnalysisHistory.filter((row) =>
          officialSourceSymbols.has(String(row.source_symbol ?? '').trim().toUpperCase())
        )
      : rawAnalysisHistory;
    if (activeVersions) {
      const consensusCoverage = assessMonthlyConsensusCoverage(analysisHistory, {
        minimumGenerations: Number(process.env.MODEL_PORTFOLIO_MIN_GENERATIONS) || undefined,
        minimumSpanDays: Number(process.env.MODEL_PORTFOLIO_MIN_SPAN_DAYS) || undefined,
      });
      if (!consensusCoverage.ok) {
        const details = consensusCoverage.horizons
          .map(
            (item) =>
              `${item.horizon}: ${item.generationCount}/${consensusCoverage.minimumGenerations} tarama, ` +
              `${item.spanDays}/${consensusCoverage.minimumSpanDays} gün`
          )
          .join('; ');
        throw new Error(
          `Aylık konsensüs için yeterli geçmiş henüz birikmedi (${details}). ` +
            'Tek 6 saatlik analizle resmi aylık sepet yayınlanmadı.'
        );
      }
    }
    assertIncumbentAnalysisCoverage(previousPortfolios, effectiveRows);
    const currentCandidates = officialModelRows(effectiveRows)
      .map((row) => ({
        ...row.data,
        horizon: row.horizon,
        market: row.data?.market ?? row.market,
        // Aynı display ticker farklı piyasalarda bulunabilir. Konsensüs ve
        // carry-over kimliği için Yahoo/piyasa sembolünü ayrıca taşı.
        sourceSymbol: String(row.symbol ?? '').trim().toUpperCase(),
      }));
    const draftPortfolios = buildModelPortfolios({
      shortCandidates: currentCandidates.filter((candidate) => candidate.horizon === 'short'),
      longCandidates: currentCandidates.filter((candidate) => candidate.horizon === 'long'),
      generatedAt: decisionAt,
      sourceGeneration: generation,
      cycleStart: decisionAt,
      analysisHistory,
      previousPortfolios,
    });
    const trackingBaseline = await getModelPortfolioTrackingBaseline(decisionAt, [
      ...draftPortfolios,
      ...previousPortfolios,
    ]);
    const trackedPreviousPortfolios = previousPortfolios.filter(
      (portfolio) => portfolio?.versionKey && portfolio?.tracking
    );
    const closingSplitFactors = await getModelPortfolioSplitFactors(
      trackedPreviousPortfolios,
      decisionAt
    );
    const modelPortfolios = applyModelPortfolioTrackingBaseline(
      draftPortfolios,
      trackingBaseline
    );
    assertCompleteModelPortfolioSet(modelPortfolios, 'Yeni aylık model portföy kümesi');

    // null => sürüm migration'ı henüz yok. Bu durumda mevcut davranışla güncel
    // tabloyu beslemeye devam et; aday üretim turunu migration yüzünden bozma.
    if (activeVersions) {
      const closingNavRows = buildPreviousModelPortfolioClosingRows(
        previousPortfolios,
        trackingBaseline,
        decisionAt,
        closingSplitFactors
      );
      const previousVersionKeys = previousPortfolios
        .map((portfolio) => String(portfolio?.versionKey ?? '').trim())
        .filter(Boolean);
      const versionRows = modelPortfolios.map((portfolio) => ({
        version_key: portfolio.versionKey,
        slug: portfolio.slug,
        risk_tier: portfolio.riskTier,
        source_generation: generation,
        cycle_start: portfolio.cycleStart,
        cycle_end: portfolio.cycleEnd,
        status: 'active',
        methodology_version: portfolio.methodologyVersion,
        base_currency: 'TRY',
        data: portfolio,
        created_at: decisionAt,
        updated_at: decisionAt,
      }));
      const initialBenchmarks = Object.fromEntries(
        MODEL_PORTFOLIO_BENCHMARKS.map((benchmark) => [benchmark.key, 0])
      );
      const initialNavRows = versionRows.map((version) => ({
        version_key: version.version_key,
        nav_date: istanbulDate(new Date(version.cycle_start)),
        observed_at: version.cycle_start,
        nav_value: 100,
        return_pct: 0,
        coverage_pct: 100,
        benchmarks: initialBenchmarks,
      }));

      // Eski dönemi kapatma, dört yeni append-only sürümü açma, başlangıç
      // NAV'larını ve current pointer'ları yazma tek PostgreSQL transaction'ıdır.
      // Herhangi bir adım başarısızsa önceki aktif küme olduğu gibi korunur.
      await sb('rpc/publish_model_portfolio_cycle', {
        method: 'POST',
        body: {
          p_decision_at: decisionAt,
          p_previous_version_keys: previousVersionKeys,
          p_closing_nav: closingNavRows,
          p_versions: versionRows,
          p_initial_nav: initialNavRows,
          p_current_rows: currentPortfolioRows(modelPortfolios, decisionAt),
        },
      });
      const storedVersions = await sb(
        `model_portfolio_versions?cycle_start=eq.${encodeURIComponent(decisionAt)}` +
          '&select=version_key,slug,risk_tier,cycle_start,cycle_end,status,data' +
          '&order=risk_tier.asc'
      );
      assertCompleteModelPortfolioSet(storedVersions, 'Kalıcı aylık sürüm kümesi');
    } else {
      await sb('model_portfolios', {
        method: 'POST',
        body: currentPortfolioRows(modelPortfolios, decisionAt),
        prefer: 'resolution=merge-duplicates',
      });
    }
    console.log(
      `Model portföy: ${modelPortfolios.length} sepet ${modelPortfolios[0].cycleEnd} tarihine kadar kilitlendi.`
    );
  }
  // --- Kesinlik teyidi (turun TEK AI adımı) ---
  // AI yalnızca aşağı yönlü teyit verebilir. Tamamlanırsa aynı jenerasyon
  // yerinde güncellenir; tamamlanmazsa yukarıdaki kural skorları geçerli kalır.
  try {
    const confirmedRows = await confirmFinalists(deepRows);
    if (confirmedRows.length > 0) {
      const patched = await publishAiConvictions(confirmedRows, generation);
      console.log(`Kesinlik teyidi: ${patched}/${confirmedRows.length} satır aynı jenerasyonda güvenle güncellendi.`);
    }
  } catch (err) {
    console.error(`[kesinlik] adım atlandı: ${err.message}`);
  }

  // AI sürerken 20 dakikalık olay nöbeti aynı jenerasyonda daha taze kanıt
  // yazmış olabilir. CAS patch'i o satırı bilinçli olarak ezmez; aylık karar da
  // bellekteki eski kanıtı kullanmasın diye jenerasyonu veritabanından yeniden oku.
  try {
    const refreshedRows = await getCandidateGenerationRows(generation);
    const expectedKeys = new Set(deepRows.map((row) => `${row.symbol}:${row.horizon}`));
    const actualKeys = new Set(
      (refreshedRows ?? []).map((row) => `${row.symbol}:${row.horizon}`)
    );
    const exactGeneration =
      refreshedRows?.length === deepRows.length &&
      actualKeys.size === expectedKeys.size &&
      [...expectedKeys].every((key) => actualKeys.has(key));
    if (!exactGeneration) {
      throw new Error(
        `jenerasyon kapsamı ${refreshedRows?.length ?? 0}/${deepRows.length}; ` +
          'eksik veya farklı DB görünümüyle aylık karar alınmadı'
      );
    }
    effectiveRows = refreshedRows;
  } catch (err) {
    console.error(`[model-portfolios] kesinlik sonrası doğrulama başarısız: ${err.message}`);
  }

  if (effectiveRows) {
    // Aylık konsensüs, AI teyidi uygulanmış son durum dahil her başarılı 6 saatlik
    // derin turu append-only saklar. Migration yoksa eski tek-jenerasyon fallback'i
    // çalışmaya devam eder.
    try {
      await snapshotCandidateAnalyses(officialModelRows(effectiveRows), generation, generatedAt);
    } catch (err) {
      console.error(`[candidate-history] analiz geçmişi atlandı: ${err.message}`);
    }
    try {
      await sb('rpc/prune_candidate_analysis_snapshots', {
        method: 'POST',
        body: { p_keep_days: 60 },
      });
    } catch (err) {
      console.error(`[candidate-history] 60 günlük bakım atlandı: ${err.message}`);
    }

    // Portföyü AI teyidi ve analiz geçmişi yazımından sonra oluştur. Böylece yeni
    // aylık sürüm son turun kural skoruyla yetinmez; mümkünse 30 günlük konsensüsü
    // ve aynı turun nihai conviction sonucunu kullanır.
    try {
      await publishModelPortfolios();
    } catch (err) {
      console.error(`[model-portfolios] adım atlandı: ${err.message}`);
    }

    // Backtest skor anlık görüntüsü
    try {
      await snapshotScores(effectiveRows, generation);
    } catch (err) {
      console.error(`[snapshot] adım atlandı: ${err.message}`);
    }
  } else {
    console.error(
      '[model-portfolios] doğrulanmış tam jenerasyon olmadığı için analiz geçmişi, ' +
        'aylık yayın ve backtest snapshot adımları güvenli biçimde atlandı.'
    );
  }

  // --- Başlık çevirisi (en sonda, OLABİLDİĞİNCE) ---
  // Adaylar zaten yazıldı; bu adım yavaş olsa/timeout'a düşse bile vitrin etkilenmez.
  // Vitrindeki ilk 50+50'nin başlıklarını Türkçeleştirir → Haber sayfası ve BİR
  // SONRAKİ turun kartları için.
  try {
    await enrichGatedTitles(gatedSet);
  } catch (err) {
    console.error(`[enrich] adım atlandı: ${err.message}`);
  }
}

/**
 * Yalnızca kural motoruyla vitrin eşiğini geçen adayları AI teyidinden geçirir.
 *
 * Aynı sembolün kısa ve uzun vade adayları AYNI conviction nesnesini paylaşır
 * (buildCandidatePair tek nesne üretip ikisine de koyar), bu yüzden AI sembol
 * başına BİR kez çalışır ve sonuç iki satıra da yazılır — aynı kanıt için iki
 * kez ödeme yapılmaz.
 */
async function confirmFinalists(rows) {
  if (!isConvictionAiEnabled()) {
    console.log('Kesinlik teyidi: ANTHROPIC_API_KEY yok, kural skorlarıyla devam ediliyor.');
    return [];
  }

  const bySymbol = new Map();
  for (const r of rows) {
    const c = r.data?.conviction;
    if (
      !c ||
      c.score < CONVICTION_THRESHOLD ||
      !c.evidence?.length ||
      r.data?.expectation?.hasActionableEdge === false
    ) continue;
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
    console.log('Kesinlik teyidi: kural eşiğini geçen aday yok, AI çağrısı yapılmadı.');
    return [];
  }

  const before = new Map(finalists.map((finalist) => [finalist.symbol, finalist.conviction]));
  await confirmConviction(finalists);
  const processed = finalists.filter((finalist) => finalist.conviction !== before.get(finalist.symbol));

  // Yalnız gerçekten cache/AI kararı uygulanmış kesinliği ilgili aday satırlarına yaz.
  for (const f of processed) {
    for (const r of f.rows) r.data.conviction = f.conviction;
  }
  return processed.flatMap((finalist) => finalist.rows);
}

/**
 * Uzun süren AI çağrısı sırasında olay nöbetinin yazdığı taze veriyi ezmeden,
 * yalnız aynı jenerasyon + aynı kanıt imzasındaki conviction alanını günceller.
 */
async function publishAiConvictions(rows, generation) {
  let patched = 0;
  await mapLimit(rows, 5, async (row) => {
    const baseFilter =
      `symbol=eq.${encodeURIComponent(row.symbol)}` +
      `&horizon=eq.${encodeURIComponent(row.horizon)}` +
      `&generation=eq.${generation}`;
    const currentRows = await sb(`candidates?${baseFilter}&select=data,updated_at`);
    const current = currentRows?.[0];
    if (!current?.data || !current.updated_at) return;
    if (
      buildEvidenceSignature(current.data.conviction) !==
      buildEvidenceSignature(row.data.conviction)
    ) return;

    const result = await sb(
      `candidates?${baseFilter}&updated_at=eq.${encodeURIComponent(current.updated_at)}`,
      {
        method: 'PATCH',
        body: {
          data: { ...current.data, conviction: row.data.conviction },
          updated_at: new Date().toISOString(),
        },
        prefer: 'return=representation',
      }
    );
    if (result?.length) patched += 1;
  });
  return patched;
}

/**
 * Her başarılı 6 saatlik derin turun portföy seçiminde gerekli kompakt
 * özelliklerini saklar. Tam aday JSON'u yerine faktörler ve profil skorları
 * tutulur; aylık konsensüs güncel aday nesnesiyle birleştirilir.
 */
async function snapshotCandidateAnalyses(rows, generation, capturedAt) {
  const byHorizon = { short: [], long: [] };
  for (const row of rows) {
    if (byHorizon[row.horizon]) {
      byHorizon[row.horizon].push({
        ...row.data,
        _sourceSymbol: String(row.symbol ?? '').trim().toUpperCase(),
      });
    }
  }

  const payload = [];
  for (const horizon of ['short', 'long']) {
    const ranked = scoreAndRankCandidates(byHorizon[horizon], horizon, capturedAt);
    const profiles = MODEL_PORTFOLIO_PROFILES.filter((profile) => profile.horizon === horizon);
    for (const candidate of ranked) {
      const profileScores = {};
      const eligibility = {};
      for (const profile of profiles) {
        const score = Number(getModelPortfolioProfileScore(candidate, profile));
        profileScores[profile.slug] = Number.isFinite(score)
          ? Number(Math.min(100, Math.max(0, score)).toFixed(2))
          : null;
        eligibility[profile.slug] = isModelPortfolioCandidateEligible(candidate, profile);
      }
      payload.push({
        generation,
        source_symbol:
          candidate._sourceSymbol ||
          toModelPortfolioMarketSymbol({ ticker: candidate.symbol, market: candidate.market }),
        symbol: String(candidate.symbol ?? '').trim().toUpperCase(),
        horizon,
        captured_at: capturedAt,
        market: candidate.market ?? null,
        opportunity_score: candidate.shortTermScore,
        rank: candidate.rank ?? null,
        profile_scores: profileScores,
        eligibility,
        factor_scores: candidate.scoreBreakdown ?? {},
        risk_level: candidate.riskLevel ?? null,
        liquidity_level: candidate.liquidityLevel ?? null,
        expected_return_pct: candidate.expectation?.expectedReturnPct ?? null,
        conviction_rule_score:
          candidate.conviction?.ruleScore ?? candidate.conviction?.score ?? null,
        conviction_score: candidate.conviction?.score ?? null,
        ai_used: candidate.conviction?.aiCertainty != null,
        ai_cache_hit: Boolean(candidate.conviction?.aiCacheHit),
        ai_certainty: candidate.conviction?.aiCertainty ?? null,
        evidence_signature: candidate.conviction?.evidence?.length
          ? buildEvidenceSignature(candidate.conviction)
          : null,
        analysis_depth: candidate.analysisDepth ?? null,
      });
    }
  }

  if (!payload.length) return;
  await sb('candidate_analysis_snapshots', {
    method: 'POST',
    body: payload,
    prefer: 'resolution=ignore-duplicates',
  });
  console.log(`Aylık konsensüs geçmişi: ${payload.length} analiz özeti eklendi.`);
}

/** Aday skorlarını score_snapshots tablosuna ekler (backtest track record'u). */
async function snapshotScores(rows, generation) {
  const referenceMs = Date.now();
  const capturedAt = new Date(referenceMs).toISOString();
  const episodeDate = capturedAt.slice(0, 10);
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
        captured_at: capturedAt,
        generation,
        signal_key: `${episodeDate}:${c.market ?? 'unknown'}:${c.symbol}:${horizon}`,
        conviction_rule_score: c.conviction?.ruleScore ?? c.conviction?.score ?? null,
        conviction_final_score: c.conviction?.score ?? null,
        ai_used: c.conviction?.aiCertainty != null,
        ai_cache_hit: Boolean(c.conviction?.aiCacheHit),
        ai_certainty: c.conviction?.aiCertainty ?? null,
        evidence_signature: c.conviction?.evidence?.length
          ? buildEvidenceSignature(c.conviction)
          : null,
      });
    }
  }

  if (snapshots.length === 0) return;
  await sb('score_snapshots', {
    method: 'POST',
    body: snapshots,
    prefer: 'resolution=ignore-duplicates',
  });
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
  const activeModelVersions = await getActiveModelPortfolioVersions();
  const modelSymbols = (activeModelVersions ?? []).flatMap((version) =>
    (version.data?.holdings ?? []).map(toModelPortfolioMarketSymbol).filter(Boolean)
  );
  const valuationSymbols = [
    ...new Set([
      ...plan.evaluate,
      ...modelSymbols,
      ...MODEL_PORTFOLIO_BENCHMARKS.map((benchmark) => benchmark.symbol),
    ]),
  ];
  console.log(
    `Mod: ${MODE} | nöbet: ${plan.evaluate.length} sembol değerlendirilecek, ` +
      `${plan.fetch.length} sembolün haberi çekilecek (${symbols.length} izlenen her turda)`
  );

  const quoteMap = await collectQuotes(valuationSymbols);
  try {
    await snapshotModelPortfolioPerformance(activeModelVersions, quoteMap);
  } catch (err) {
    console.error(`[model-portfolios] performans noktası atlandı: ${err.message}`);
  }
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

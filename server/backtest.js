/**
 * Nokta-zaman ileri-test raporu.
 *
 * - kısa: 20 işlem seansı, uzun: 252 işlem seansı
 * - aynı sembol/vade/günün tekrarları tek sinyal epizodu sayılır
 * - endekse göre fazla getiri ve tahmini işlem maliyeti sonrası net sonuç raporlanır
 */
import YahooFinance from 'yahoo-finance2';
import { mapLimit } from './concurrency.js';
import {
  TRADING_WINDOWS,
  closeOnOrBefore,
  dedupeSignalEpisodes,
  forwardTradingClose,
  mean,
  summarizeReturns,
} from './backtestMetrics.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAGE_SIZE = 1000;
const DAY_MS = 86_400_000;
const BANDS = [
  { label: 'Güçlü (75+)', test: (score) => score >= 75 },
  { label: 'Orta (60-74)', test: (score) => score >= 60 && score < 75 },
  { label: 'Zayıf (<60)', test: (score) => score < 60 },
];

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const pct = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;

function costBps(market) {
  const name = market === 'BIST' ? 'BACKTEST_BIST_COST_BPS' : 'BACKTEST_US_COST_BPS';
  const fallback = market === 'BIST' ? 30 : 10;
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function benchmarkSymbol(market) {
  return market === 'BIST' ? 'XU100.IS' : '^GSPC';
}

async function sbGetAll(pathAndQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Range: `${from}-${from + PAGE_SIZE - 1}`,
      },
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function fetchCloses(symbol, period1) {
  try {
    const result = await yahooFinance.chart(symbol, { period1, interval: '1d' });
    return (result?.quotes ?? [])
      .filter((quote) => quote.close != null)
      .map((quote) => ({ t: new Date(quote.date).getTime(), close: quote.close }))
      .sort((a, b) => a.t - b.t);
  } catch (error) {
    console.warn(`[backtest] ${symbol} geçmişi alınamadı: ${error.message}`);
    return [];
  }
}

function bucketFor(buckets, horizon, band, aiGroup) {
  const key = `${horizon}|${band}|${aiGroup}`;
  if (!buckets[key]) buckets[key] = { gross: [], excess: [], costs: [] };
  return buckets[key];
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.');
  }

  const raw = await sbGetAll('score_snapshots?select=*&order=captured_at.asc');
  const snapshots = dedupeSignalEpisodes(raw);
  if (!snapshots.length) {
    console.log('Henüz skor anlık görüntüsü yok.');
    return;
  }

  const earliest = Math.min(...snapshots.map((snapshot) => new Date(snapshot.captured_at).getTime()));
  const period1 = new Date(earliest - 10 * DAY_MS);
  const stockSymbols = snapshots.map((snapshot) =>
    snapshot.market === 'BIST' && !String(snapshot.symbol).endsWith('.IS')
      ? `${snapshot.symbol}.IS`
      : snapshot.symbol
  );
  const symbols = [...new Set([...stockSymbols, ...snapshots.map((s) => benchmarkSymbol(s.market))])];
  const histories = new Map();
  await mapLimit(symbols, 6, async (symbol) => {
    histories.set(symbol, await fetchCloses(symbol, period1));
  });

  const now = Date.now();
  const buckets = {};
  let pending = 0;
  let evaluated = 0;

  for (const snapshot of snapshots) {
    const sessions = TRADING_WINDOWS[snapshot.horizon];
    if (!sessions) continue;
    const capturedMs = new Date(snapshot.captured_at).getTime();
    const yahooSymbol =
      snapshot.market === 'BIST' && !String(snapshot.symbol).endsWith('.IS')
        ? `${snapshot.symbol}.IS`
        : snapshot.symbol;
    const closes = histories.get(yahooSymbol) ?? [];
    const end = forwardTradingClose(closes, capturedMs, sessions);
    if (!end || end.t > now) {
      pending++;
      continue;
    }
    const start = Number(snapshot.capture_price) > 0
      ? { close: Number(snapshot.capture_price), t: capturedMs }
      : closeOnOrBefore(closes, capturedMs);
    if (!start?.close || !end.close) continue;
    const gross = end.close / start.close - 1;

    const benchmark = histories.get(benchmarkSymbol(snapshot.market)) ?? [];
    const benchmarkStart = closeOnOrBefore(benchmark, capturedMs);
    const benchmarkEnd = closeOnOrBefore(benchmark, end.t);
    const benchmarkReturn =
      benchmarkStart?.close && benchmarkEnd?.close
        ? benchmarkEnd.close / benchmarkStart.close - 1
        : null;

    const band = BANDS.find((item) => item.test(snapshot.score))?.label ?? '?';
    const aiGroup = snapshot.ai_used ? 'AI teyitli' : 'Kural';
    for (const group of [aiGroup, 'Tümü']) {
      const bucket = bucketFor(buckets, snapshot.horizon, band, group);
      bucket.gross.push(gross);
      if (benchmarkReturn != null) bucket.excess.push(gross - benchmarkReturn);
      bucket.costs.push(costBps(snapshot.market));
    }
    evaluated++;
  }

  console.log('='.repeat(92));
  console.log('İLERİ-TEST RAPORU — işlem seansı, tekil sinyal epizodu, maliyet sonrası');
  console.log(
    `Ham snapshot: ${raw.length} | tekil epizot: ${snapshots.length} | değerlendirilen: ${evaluated} | bekleyen: ${pending}`
  );
  console.log(`Pencereler: kısa ${TRADING_WINDOWS.short} işlem günü, uzun ${TRADING_WINDOWS.long} işlem günü`);
  console.log('='.repeat(92));

  for (const horizon of ['short', 'long']) {
    console.log(`\n${horizon === 'short' ? 'KISA VADE' : 'UZUN VADE'}`);
    for (const aiGroup of ['Tümü', 'AI teyitli', 'Kural']) {
      const rows = BANDS.map((band) => {
        const data = buckets[`${horizon}|${band.label}|${aiGroup}`];
        if (!data?.gross.length) return null;
        const averageCost = mean(data.costs);
        return { band: band.label, ...summarizeReturns(data.gross, data.excess, averageCost) };
      }).filter(Boolean);
      if (!rows.length) continue;
      console.log(`  ${aiGroup}`);
      console.log('  Bant            n   Brüt Ort.  Net Ort.  Net İsabet  Net Excess  Excess t');
      for (const row of rows) {
        console.log(
          `  ${row.band.padEnd(14)} ${String(row.count).padStart(4)}  ${pct(row.grossMean).padStart(9)} ` +
            `${pct(row.netMean).padStart(9)}  ${(row.hitRateNet * 100).toFixed(0).padStart(8)}%  ` +
            `${pct(row.excessMeanNet).padStart(10)}  ${row.excessTStat == null ? '—' : row.excessTStat.toFixed(2)}`
        );
      }
    }
  }

  console.log('\nNot: Sonuçlar yatırım getirisi garantisi değildir. Yeni eşik/faktörler yalnızca ileri dönem ve maliyet sonrası doğrulanmalıdır.');
}

main().catch((error) => {
  console.error(`Backtest hatası: ${error.message}`);
  process.exitCode = 1;
});

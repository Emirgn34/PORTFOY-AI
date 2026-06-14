/**
 * Backtest (ileri-test) raporu.
 *
 * score_snapshots tablosundaki geçmiş skorları, gerçek geçmiş fiyatlarla
 * eşleştirir ve "yüksek skorlu adaylar gerçekten getiriyi öngördü mü?"
 * sorusunu ölçer. Her anlık görüntü için SABİT pencere ileri getirisi
 * hesaplanır (kısa vade 21 gün, uzun vade 90 gün) ve aynı dönemdeki endeks
 * getirisiyle karşılaştırılır (excess = hisse − endeks).
 *
 * Sonuçlar skor bandına göre gruplanır; üst bant alt bandı geçiyorsa skor
 * sinyal taşıyor demektir. Vadesi henüz dolmamış görüntüler "bekleyen" sayılır.
 *
 * Çalıştırma (GitHub Actions veya lokal):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node server/backtest.js
 */
import YahooFinance from 'yahoo-finance2';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('HATA: SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.');
  process.exit(1);
}

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const DAY_MS = 24 * 60 * 60 * 1000;

// Vade başına sabit değerlendirme penceresi (takvim günü) ve skor bantları.
const WINDOW_DAYS = { short: 21, long: 90 };
const BANDS = [
  { label: 'Güçlü (75+)', test: (s) => s >= 75 },
  { label: 'Orta (60-74)', test: (s) => s >= 60 && s < 75 },
  { label: 'Zayıf (<60)', test: (s) => s < 60 },
];

async function sbGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Bir sembolün günlük kapanışlarını {t, close} dizisi olarak getirir (artan tarih). */
async function fetchCloses(symbol, period1) {
  try {
    const res = await yahooFinance.chart(symbol, { period1, interval: '1d' });
    return (res?.quotes ?? [])
      .filter((q) => q.close != null)
      .map((q) => ({ t: new Date(q.date).getTime(), close: q.close }))
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}

/** targetMs'ye en yakın (mode: 'before' → öncesi/eşit, 'after' → sonrası/eşit) kapanış. */
function closeAt(closes, targetMs, mode) {
  if (!closes.length) return null;
  if (mode === 'before') {
    let found = null;
    for (const c of closes) {
      if (c.t <= targetMs) found = c.close;
      else break;
    }
    return found;
  }
  for (const c of closes) {
    if (c.t >= targetMs) return c.close;
  }
  return null;
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const pct = (n) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;

function benchmarkSymbol(market) {
  return market === 'BIST' ? 'XU100.IS' : '^GSPC';
}

async function main() {
  const snapshots = await sbGet(
    'score_snapshots?select=*&order=captured_at.asc&limit=20000'
  );
  if (!snapshots.length) {
    console.log('Henüz skor anlık görüntüsü yok. Aday üreticisi çalıştıkça birikecek.');
    return;
  }

  const now = Date.now();
  const earliest = Math.min(...snapshots.map((s) => new Date(s.captured_at).getTime()));
  const period1 = new Date(earliest - 7 * DAY_MS);

  // Her sembolün ve endekslerin geçmişini bir kez çek
  const symbols = [...new Set(snapshots.map((s) => (s.market === 'BIST' ? `${s.symbol}.IS` : s.symbol)))];
  const benchSymbols = [...new Set(snapshots.map((s) => benchmarkSymbol(s.market)))];

  const histories = new Map();
  for (const sym of [...symbols, ...benchSymbols]) {
    histories.set(sym, await fetchCloses(sym, period1));
  }

  // Vade + bant bazında toplama
  const buckets = {}; // `${horizon}|${band}` -> { rets:[], excess:[] }
  let pending = 0;
  let evaluated = 0;

  for (const snap of snapshots) {
    const window = WINDOW_DAYS[snap.horizon];
    if (!window) continue;
    const capturedMs = new Date(snap.captured_at).getTime();
    const evalMs = capturedMs + window * DAY_MS;
    if (evalMs > now) {
      pending++;
      continue; // vade henüz dolmadı
    }

    const yahooSym = snap.market === 'BIST' ? `${snap.symbol}.IS` : snap.symbol;
    const closes = histories.get(yahooSym) ?? [];
    const p0 = Number(snap.capture_price) || closeAt(closes, capturedMs, 'before');
    const pEval = closeAt(closes, evalMs, 'after');
    if (!(p0 > 0) || !(pEval > 0)) continue;
    const realized = pEval / p0 - 1;

    // Endeks getirisi (aynı pencere)
    const bench = histories.get(benchmarkSymbol(snap.market)) ?? [];
    const b0 = closeAt(bench, capturedMs, 'before');
    const bEval = closeAt(bench, evalMs, 'after');
    const benchRet = b0 > 0 && bEval > 0 ? bEval / b0 - 1 : null;

    const band = BANDS.find((b) => b.test(snap.score))?.label ?? '?';
    const key = `${snap.horizon}|${band}`;
    if (!buckets[key]) buckets[key] = { rets: [], excess: [] };
    buckets[key].rets.push(realized);
    if (benchRet != null) buckets[key].excess.push(realized - benchRet);
    evaluated++;
  }

  // --- Rapor ---
  console.log('='.repeat(64));
  console.log('BACKTEST RAPORU (ileri-test)');
  console.log(`Toplam anlık görüntü: ${snapshots.length} | değerlendirilen: ${evaluated} | bekleyen (vade dolmadı): ${pending}`);
  console.log(`Pencere: kısa vade ${WINDOW_DAYS.short} gün, uzun vade ${WINDOW_DAYS.long} gün`);
  console.log('='.repeat(64));

  if (evaluated === 0) {
    console.log('\nHenüz vadesi dolmuş görüntü yok; track record birikiyor.');
    console.log('İlk anlamlı kısa-vade sonuçları ~3 hafta, uzun-vade ~3 ay sonra görünür.');
    return;
  }

  for (const horizon of ['short', 'long']) {
    const label = horizon === 'short' ? 'KISA VADE' : 'UZUN VADE';
    const rows = BANDS.map((b) => {
      const data = buckets[`${horizon}|${b.label}`] ?? { rets: [], excess: [] };
      return { band: b.label, ...data };
    }).filter((r) => r.rets.length > 0);

    console.log(`\n${label}`);
    if (!rows.length) {
      console.log('  (vadesi dolmuş veri yok)');
      continue;
    }
    console.log('  Bant            n    Ort.Getiri  İsabet   Ort.Excess(endekse göre)  Medyan');
    for (const r of rows) {
      const hit = r.rets.filter((x) => x > 0).length / r.rets.length;
      const ex = r.excess.length ? pct(mean(r.excess)) : '—';
      console.log(
        `  ${r.band.padEnd(14)} ${String(r.rets.length).padStart(3)}   ` +
          `${pct(mean(r.rets)).padStart(8)}   ${(hit * 100).toFixed(0).padStart(4)}%   ` +
          `${ex.padStart(10)}              ${pct(median(r.rets)).padStart(7)}`
      );
    }

    // Basit yorum: üst bant alt bandı geçiyor mu?
    const strong = buckets[`${horizon}|Güçlü (75+)`];
    const weak = buckets[`${horizon}|Zayıf (<60)`];
    if (strong?.excess?.length && weak?.excess?.length) {
      const diff = mean(strong.excess) - mean(weak.excess);
      console.log(
        diff > 0
          ? `  → Sinyal var: Güçlü bant, Zayıf bandı endekse göre ${pct(diff)} geçiyor.`
          : `  → Sinyal YOK/ters: Güçlü bant, Zayıf bandın gerisinde (${pct(diff)}).`
      );
    }
  }

  console.log('\nNot: Tek başına getiri değil, ENDEKSE GÖRE excess ve üst-vs-alt bant farkı önemlidir.');
  console.log('Örneklem küçükken sonuçlar gürültülüdür; birkaç ay biriktikçe anlam kazanır.');
}

main().catch((err) => {
  console.error('Backtest hatası:', err.message);
  process.exit(1);
});

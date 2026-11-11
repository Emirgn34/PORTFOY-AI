/**
 * Tekrarlayan düşüş istatistiği — "bu hisse benzer düşüşlerden sonra geçmişte
 * ne yaptı?" sorusunun ÖLÇÜLMÜŞ cevabı.
 *
 * Kullanıcının istediği şey ("IONQ 31'e düştü, geçmişte benzer düşüşlerden
 * sonra ne oldu?") ücretsiz Yahoo GÜNLÜK verisiyle dürüstçe yapılabilen tek
 * biçimde yapılır: güncel düşüş derinliği kovalara ayrılır (%15/20/25/30/40),
 * aynı kovaya geçmişte her girişin 1/5/10 işlem günü sonrası getirisi ölçülür
 * ve medyan + isabet payı + en kötü durum raporlanır.
 *
 * SINIRLAR (bilerek):
 *  - Bu bir TAHMİN değildir; yalnızca geçmiş dağılımdır ve metinler bunu söyler.
 *  - Saatlik değil İŞLEM GÜNÜ ufku kullanılır: saat çözünürlüğü için yeterli
 *    ücretsiz geçmiş yok (1 dk bar yalnızca ~7 gün geriye gider).
 *  - Canlı trade sinyali DEĞİLDİR: tradeEngine'in veri kalite kapılarına
 *    dokunmaz; ayrı 'pattern' bildirim konusunda, gecikmeli veri uyarısıyla gider.
 *  - Bir düşüş bölümü (episode) için EN FAZLA BİR bildirim üretilir: olay
 *    kimliği sembol + kova + kovaya giriş gününden türetilir.
 */
import { createHash } from 'node:crypto';

export const DIP_HIGH_WINDOW = 50;
export const DIP_BUCKETS = [15, 20, 25, 30, 40];
export const DIP_HORIZONS = [1, 5, 10];
/** Bölüm başları arasında en az bu kadar işlem günü olmalı (testere kesimi sayılmasın). */
const MIN_GAP_DAYS = 10;
/** Kovaya giriş bu kadar işlem gününden eskiyse artık "taze düşüş" değildir. */
const FRESH_CROSS_DAYS = 5;

const round1 = (n) => Math.round(n * 10) / 10;

function rollingMax(values, window, index) {
  let max = -Infinity;
  for (let i = Math.max(0, index - window + 1); i <= index; i++) {
    if (values[i] > max) max = values[i];
  }
  return max;
}

/** Kapanışlardan %cinsinden düşüş serisi (50 günlük kayan zirveye göre, ≤0). */
export function drawdownSeries(closes, highWindow = DIP_HIGH_WINDOW) {
  return closes.map((close, i) => (close / rollingMax(closes, highWindow, i) - 1) * 100);
}

/**
 * Bir eşik için geçmiş "kovaya giriş" olaylarını bulur ve ileri getirileri ölçer.
 * @param bars [{date:ISO, close:number}] artan tarihli günlük barlar
 * @returns {events, horizons:{h1:{...},h5:{...},h10:{...}}} | null (örnek < 3)
 */
export function computeDipStats(bars, thresholdPct, { highWindow = DIP_HIGH_WINDOW, horizons = DIP_HORIZONS } = {}) {
  const closes = bars.map((bar) => bar.close);
  if (closes.length < highWindow + Math.max(...horizons) + 5) return null;
  const dd = drawdownSeries(closes, highWindow);
  const eventIndexes = [];
  let lastStart = -Infinity;
  for (let i = 1; i < closes.length; i++) {
    if (dd[i] <= -thresholdPct && dd[i - 1] > -thresholdPct && i - lastStart >= MIN_GAP_DAYS) {
      eventIndexes.push(i);
      lastStart = i;
    }
  }
  const result = {};
  let usable = 0;
  for (const horizon of horizons) {
    const samples = eventIndexes
      .filter((i) => i + horizon < closes.length)
      .map((i) => (closes[i + horizon] / closes[i] - 1) * 100)
      .sort((a, b) => a - b);
    if (samples.length < 3) {
      result[`h${horizon}`] = null;
      continue;
    }
    usable++;
    const mid = Math.floor(samples.length / 2);
    result[`h${horizon}`] = {
      count: samples.length,
      medianPct: round1(samples.length % 2 ? samples[mid] : (samples[mid - 1] + samples[mid]) / 2),
      positiveCount: samples.filter((value) => value > 0).length,
      worstPct: round1(samples[0]),
      bestPct: round1(samples[samples.length - 1]),
    };
  }
  if (!usable) return null;
  return { thresholdPct, events: eventIndexes.length, horizons: result };
}

/** Güncel düşüş durumu: hangi kovada, kovaya ne zaman girdi? */
export function analyzeCurrentDip(bars, { highWindow = DIP_HIGH_WINDOW } = {}) {
  const closes = bars.map((bar) => bar.close);
  if (closes.length < highWindow + 10) return null;
  const dd = drawdownSeries(closes, highWindow);
  const last = closes.length - 1;
  const currentPct = dd[last];
  const bucket = [...DIP_BUCKETS].reverse().find((b) => currentPct <= -b) ?? 0;
  if (!bucket) return { bucket: 0, drawdownPct: round1(currentPct), crossedAt: null, daysSinceCross: null };
  let start = last;
  while (start > 0 && dd[start - 1] <= -bucket) start--;
  return {
    bucket,
    drawdownPct: round1(currentPct),
    crossedAt: bars[start].date,
    daysSinceCross: last - start,
    lastClose: closes[last],
    lastDate: bars[last].date,
  };
}

/**
 * Taze ve geçmişte işe yaramış bir düşüş için bildirim olayı üretir; aksi
 * halde null. "İşe yaramış": ≥3 geçmiş örnek, 5 günlük medyan ≥ +%2 ve
 * örneklerin ≥ %60'ı pozitif. Kötü istatistikli düşüşlerde bildirim YOK —
 * gürültü, güveni harcar.
 */
export function buildDipAlertEvent({ symbol, name, stats, state, now = new Date() }) {
  if (!stats || !state || !state.bucket || state.daysSinceCross == null) return null;
  if (state.daysSinceCross > FRESH_CROSS_DAYS) return null;
  const h5 = stats.horizons.h5;
  if (!h5 || h5.count < 3 || h5.medianPct < 2 || h5.positiveCount / h5.count < 0.6) return null;
  const h10 = stats.horizons.h10;
  const id = createHash('sha256')
    .update(`pattern:${symbol}:${state.bucket}:${state.crossedAt}`)
    .digest('hex');
  const price = state.lastClose >= 100 ? state.lastClose.toFixed(0) : state.lastClose.toFixed(2);
  const body =
    `${symbol} son kapanış $${price} — ${DIP_HIGH_WINDOW} günlük zirveden %${Math.abs(state.drawdownPct).toFixed(1)} aşağıda (eşik %${state.bucket}). ` +
    `Geçmişte ${h5.count} benzer düşüşte 5 işlem günü medyanı ${h5.medianPct > 0 ? '+' : ''}%${h5.medianPct} ` +
    `(${h5.positiveCount}/${h5.count} pozitif, en kötü %${h5.worstPct})` +
    (h10 ? `; 10 gün medyanı ${h10.medianPct > 0 ? '+' : ''}%${h10.medianPct}.` : '.') +
    ' Bu geçmiş istatistiktir; yükseliş tahmini veya canlı işlem sinyali değildir. Fiyat gecikmeli olabilir.';
  return {
    id,
    topic: 'pattern',
    title: `${symbol} · Tekrarlayan düşüş bölgesi`,
    body: body.slice(0, 400),
    url: '/trade',
    published_at: new Date(now).toISOString(),
    detected_at: new Date(now).toISOString(),
    expires_at: new Date(new Date(now).getTime() + 4 * 3600_000).toISOString(),
    data: {
      symbols: [symbol], kind: 'dip-stat', name: name ?? symbol,
      bucket: state.bucket, drawdownPct: state.drawdownPct, crossedAt: state.crossedAt,
      stats,
    },
  };
}

/** Günlük Yahoo chart sonucunu [{date, close}] biçimine indirger. */
export function toDailyBars(chart) {
  return (chart?.quotes ?? [])
    .filter((bar) => Number.isFinite(bar?.close) && bar.close > 0 && bar.date)
    .map((bar) => ({ date: new Date(bar.date).toISOString().slice(0, 10), close: bar.close }));
}

/**
 * Bir sembol için tam özet: güncel durum + güncel kovanın istatistiği.
 * Kova 0 ise (düşüş %15'ten sığ) stats hesaplanmaz — kart yine durumu gösterir.
 */
export function summarizeDipPattern(bars, { now = new Date() } = {}) {
  const state = analyzeCurrentDip(bars);
  if (!state) return null;
  const stats = state.bucket ? computeDipStats(bars, state.bucket) : null;
  return {
    updatedAt: new Date(now).toISOString(),
    method: `${DIP_HIGH_WINDOW} günlük kayan zirveye göre düşüş kovaları (%${DIP_BUCKETS.join('/%')}); ileri getiriler işlem günü bazındadır. Geçmiş istatistik, tahmin değildir.`,
    state,
    stats,
  };
}

/** Sembol başına yeniden tarama aralığı: günlük barlar gün içinde az değişir. */
export const PATTERN_RESCAN_MS = 6 * 3600_000;
const patternCache = new Map(); // symbol -> { summary, fetchedAt }

/**
 * Worker bağlam turu için desen özetleri. Yalnızca ABD sembolleri taranır
 * (kullanıcı tercihi ABD ağırlıklı; BIST gün yapısı ayrıca doğrulanmadı).
 * Chart isteği sembol başına 6 saatte bir yapılır; aradaki turlar süreç içi
 * önbellekten okur ki trade_context yazımı desen alanını hiç kaybetmesin.
 * Hata desen alanını boş bırakır — bağlam yazımını asla engellemez.
 *
 * @returns { bySymbol: Map<symbol, summary>, fresh: Set<symbol> } — fresh:
 *   bu çağrıda yeniden hesaplananlar (bildirim denemesi yalnızca bunlara yapılır).
 */
export async function collectDipPatterns(yahoo, symbols, { now = Date.now(), signal, cache = patternCache } = {}) {
  const bySymbol = new Map();
  const fresh = new Set();
  for (const symbol of symbols) {
    if (signal?.aborted) break;
    if (symbol.endsWith('.IS')) continue;
    const cached = cache.get(symbol);
    if (cached && now - cached.fetchedAt < PATTERN_RESCAN_MS) {
      bySymbol.set(symbol, cached.summary);
      continue;
    }
    try {
      const chart = await yahoo.chart(symbol, { period1: new Date(now - 2 * 365 * 86_400_000), interval: '1d' });
      const summary = summarizeDipPattern(toDailyBars(chart), { now: new Date(now) });
      if (summary) {
        cache.set(symbol, { summary, fetchedAt: now });
        bySymbol.set(symbol, summary);
        fresh.add(symbol);
      }
    } catch {
      // Desen isteğe bağlı araştırma bağlamıdır; eksikse kartta alan boş kalır.
    }
  }
  return { bySymbol, fresh };
}

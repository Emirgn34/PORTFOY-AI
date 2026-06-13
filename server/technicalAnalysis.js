/**
 * Teknik analiz + geçmiş grafik (analog) analizi.
 *
 * Sembolün ~2 yıllık günlük fiyatından gerçek göstergeler hesaplar
 * (RSI, MACD, hareketli ortalamalar, çoklu pencere momentum, yıllık
 * volatilite) ve ANALOG analiz yapar: bugünkü teknik kuruluma geçmişte
 * benzeyen günleri bulur, o günlerden SONRAKİ N günlük fiyat hareketinin
 * ortalamasını/kazanç oranını ölçer. Böylece "geçmişte grafik şuna benzer
 * göründüğünde bir sonraki hareket nasıl olmuş" sorusu sayısal yanıtlanır.
 *
 * Veri çekilemezse null döner; aday üretici fiyat-temelli metriklere düşer.
 */

const clampRange = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** ~years yıllık günlük kapanış + hacim getirir. */
export async function fetchDailyHistory(yahooFinance, symbol, years = 2) {
  const period1 = new Date(Date.now() - years * 365 * 24 * 60 * 60 * 1000);
  const result = await yahooFinance.chart(symbol, { period1, interval: '1d' });
  return (result?.quotes ?? [])
    .filter((q) => q.close != null)
    .map((q) => ({ date: q.date, close: q.close, volume: q.volume ?? 0 }));
}

function smaSeries(arr, n) {
  const out = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= n) sum -= arr[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function emaSeries(arr, n) {
  const k = 2 / (n + 1);
  const out = new Array(arr.length).fill(null);
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v == null) {
      out[i] = prev;
      continue;
    }
    prev = prev == null ? v : v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder RSI (period=14). */
function rsiSeries(closes, period = 14) {
  const rsi = new Array(closes.length).fill(null);
  if (closes.length <= period) return rsi;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function stdev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

const ret = (closes, i, w) => (i - w >= 0 && closes[i - w] ? (closes[i] / closes[i - w] - 1) * 100 : null);

/**
 * Bugünkü teknik kuruluma benzeyen geçmiş günleri bulur ve o günlerden
 * SONRAKİ fwd günlük fiyat hareketinin dağılımını döndürür.
 * Özellik vektörü: [RSI, fiyatın SMA50'ye uzaklığı %, 20g getiri %, 20g vol %].
 */
function analogForward(closes, rsi, sma50, fwd, warmup) {
  const n = closes.length;
  const cur = n - 1;
  const feat = (i) => {
    if (rsi[i] == null || sma50[i] == null || i - 20 < 0) return null;
    const rets = [];
    for (let k = i - 19; k <= i; k++) rets.push((closes[k] / closes[k - 1] - 1) * 100);
    return [rsi[i], (closes[i] / sma50[i] - 1) * 100, ret(closes, i, 20) ?? 0, stdev(rets)];
  };
  const curFeat = feat(cur);
  if (!curFeat) return null;

  // Özellikleri z-skoruyla normalize et (boyutlar karşılaştırılabilir olsun)
  const samples = [];
  for (let i = warmup; i <= cur - fwd; i++) {
    const f = feat(i);
    if (f) samples.push({ i, f });
  }
  if (samples.length < 20) return null;

  const dims = curFeat.length;
  const means = new Array(dims).fill(0);
  const sds = new Array(dims).fill(0);
  for (let d = 0; d < dims; d++) {
    const col = samples.map((s) => s.f[d]);
    means[d] = col.reduce((a, b) => a + b, 0) / col.length;
    sds[d] = stdev(col) || 1;
  }
  const z = (f) => f.map((v, d) => (v - means[d]) / sds[d]);
  const cz = z(curFeat);

  const scored = samples
    .map((s) => {
      const sz = z(s.f);
      let dist = 0;
      for (let d = 0; d < dims; d++) dist += (sz[d] - cz[d]) ** 2;
      const fwdRet = (closes[s.i + fwd] / closes[s.i] - 1) * 100;
      return { dist: Math.sqrt(dist), fwdRet };
    })
    .sort((a, b) => a.dist - b.dist);

  const K = Math.min(30, scored.length);
  const top = scored.slice(0, K);
  const avg = top.reduce((a, b) => a + b.fwdRet, 0) / K;
  const win = top.filter((t) => t.fwdRet > 0).length / K;
  const sorted = [...top].map((t) => t.fwdRet).sort((a, b) => a - b);
  const median = sorted[Math.floor(K / 2)];

  return { fwdDays: fwd, avg: Number(avg.toFixed(1)), win: Math.round(win * 100), count: K, median: Number(median.toFixed(1)) };
}

/**
 * Geçmiş fiyat dizisinden tüm teknik göstergeleri + analog analizleri üretir.
 * Yetersiz veri varsa null döner.
 */
export function analyzeTechnicals(history) {
  if (!history || history.length < 80) return null;
  const closes = history.map((h) => h.close);
  const n = closes.length;
  const i = n - 1;

  const sma20 = smaSeries(closes, 20);
  const sma50 = smaSeries(closes, 50);
  const sma200 = smaSeries(closes, 200);
  const rsi = rsiSeries(closes, 14);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = closes.map((_, j) => (ema12[j] != null && ema26[j] != null ? ema12[j] - ema26[j] : null));
  const signal = emaSeries(macdLine.map((v) => (v == null ? 0 : v)), 9);
  const macdHist = macdLine[i] != null && signal[i] != null ? macdLine[i] - signal[i] : 0;

  // Yıllık volatilite (son 60 günlük getiri std'i)
  const recentRets = [];
  for (let k = Math.max(1, n - 60); k < n; k++) recentRets.push((closes[k] / closes[k - 1] - 1) * 100);
  const annVol = Number((stdev(recentRets) * Math.sqrt(252)).toFixed(1));

  const high = Math.max(...closes.slice(Math.max(0, n - 252)));
  const low = Math.min(...closes.slice(Math.max(0, n - 252)));

  return {
    rsi: rsi[i] != null ? Math.round(rsi[i]) : null,
    macdHist: Number(macdHist.toFixed(3)),
    macdPositive: macdHist > 0,
    sma20: sma20[i],
    sma50: sma50[i],
    sma200: sma200[i],
    pctVsSma50: sma50[i] ? Number(((closes[i] / sma50[i] - 1) * 100).toFixed(1)) : null,
    pctVsSma200: sma200[i] ? Number(((closes[i] / sma200[i] - 1) * 100).toFixed(1)) : null,
    goldenCross: sma50[i] != null && sma200[i] != null ? sma50[i] > sma200[i] : null,
    ret5: ret(closes, i, 5) != null ? Number(ret(closes, i, 5).toFixed(1)) : null,
    ret20: ret(closes, i, 20) != null ? Number(ret(closes, i, 20).toFixed(1)) : null,
    ret60: ret(closes, i, 60) != null ? Number(ret(closes, i, 60).toFixed(1)) : null,
    annVol,
    pctFrom52High: Number(((closes[i] / high - 1) * 100).toFixed(1)),
    pctFrom52Low: Number(((closes[i] / low - 1) * 100).toFixed(1)),
    analogShort: analogForward(closes, rsi, sma50, 20, 60),
    analogLong: analogForward(closes, rsi, sma50, 60, 60),
  };
}

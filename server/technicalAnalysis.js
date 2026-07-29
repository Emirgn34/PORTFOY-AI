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
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

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
  const fwdRets = top.map((t) => t.fwdRet);
  const avg = mean(fwdRets);
  const winFrac = top.filter((t) => t.fwdRet > 0).length / K;
  const sorted = [...fwdRets].sort((a, b) => a - b);
  const median = sorted[Math.floor(K / 2)];
  const std = stdev(fwdRets);

  // Güven [0..1]: sinyal/gürültü oranı + örneklerin yön birliği + eşleşme kalitesi.
  // Üst üste binen pencereler güveni şişirebileceği için ölçü temkinli kalibre edildi;
  // amaç, ortalamayı "tahmin" gibi sunmadan sinyalin ne kadar sağlam olduğunu göstermek.
  const snr = std > 1e-6 ? Math.abs(avg) / std : 0;
  const snrScore = clamp01(snr / 0.5); // |ortalama| ≈ 0.5×std olunca tam puan
  const agreement = Math.abs(winFrac - 0.5) * 2; // 0 (50/50, tutarsız) → 1 (tek yönlü)
  const topDistMean = mean(top.map((t) => t.dist));
  const allDistSorted = scored.map((s) => s.dist).sort((a, b) => a - b);
  const allDistMedian = allDistSorted[Math.floor(allDistSorted.length / 2)] || 1;
  const distRatio = topDistMean / allDistMedian; // en yakın K, tipik mesafeye göre ne kadar yakın
  const matchQuality = clamp01(1 - (distRatio - 0.2) / 0.6); // ≤0.2 → 1, ≥0.8 → 0
  const confidence = clamp01(0.5 * snrScore + 0.3 * agreement + 0.2 * matchQuality);

  return {
    fwdDays: fwd,
    avg: Number(avg.toFixed(1)),
    win: Math.round(winFrac * 100),
    count: K,
    median: Number(median.toFixed(1)),
    std: Number(std.toFixed(1)),
    confidence: Number(confidence.toFixed(2)),
  };
}

/**
 * Yakınlığa göre ağırlıklandırılmış persentil. Ağırlıklar tazelik içindir:
 * hissenin BUGÜNLERDE nerede gezindiği, 1 yıl önce nerede gezindiğinden
 * daha belirleyicidir.
 */
function weightedPercentile(pairs, p) {
  const sorted = [...pairs].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return null;
  let cum = 0;
  for (const x of sorted) {
    cum += x.weight;
    if (cum >= p * total) return x.value;
  }
  return sorted[sorted.length - 1].value;
}

/**
 * "Bu hisse normalde nerede geziyor?" bandı.
 * Son ~1 yılın kapanışlarından, 180 günlük yarı ömürle tazeliğe göre
 * ağırlıklandırılmış %20–%80 persentil aralığı. Yani fiyatın (tazelik
 * ağırlıklı) zamanın ~%60'ında içinde bulunduğu aralık.
 */
function buildPriceBand(closes, lookback = 252) {
  const n = closes.length;
  const start = Math.max(0, n - lookback);
  const pairs = [];
  for (let i = start; i < n; i++) {
    const ageDays = n - 1 - i;
    pairs.push({ value: closes[i], weight: Math.pow(0.5, ageDays / 180) });
  }
  if (pairs.length < 40) return null;

  const low = weightedPercentile(pairs, 0.2);
  const mid = weightedPercentile(pairs, 0.5);
  const high = weightedPercentile(pairs, 0.8);
  if (low == null || mid == null || high == null || mid <= 0) return null;

  return { low, mid, high, days: pairs.length };
}

/**
 * Salınım pivotlarını (yerel tepe/dip) bulur ve birbirine yakın olanları
 * TEK bir seviyede kümeler. Bir seviyeye ne kadar çok kez dokunulmuşsa
 * (touches) o kadar anlamlı bir destek/dirençtir.
 */
function buildPivotLevels(closes, window = 5, tolerancePct = 2.5) {
  const n = closes.length;
  const pivots = [];
  for (let i = window; i < n - window; i++) {
    let isHigh = true;
    let isLow = true;
    for (let k = i - window; k <= i + window; k++) {
      if (k === i) continue;
      if (closes[k] > closes[i]) isHigh = false;
      if (closes[k] < closes[i]) isLow = false;
    }
    if (isHigh || isLow) pivots.push({ price: closes[i], index: i });
  }
  if (pivots.length < 2) return [];

  // Fiyata göre sırala, %tolerans içinde kalanları aynı kümeye topla
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const clusters = [];
  let current = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const ref = current[0].price;
    if ((sorted[i].price - ref) / ref * 100 <= tolerancePct) current.push(sorted[i]);
    else {
      clusters.push(current);
      current = [sorted[i]];
    }
  }
  clusters.push(current);

  return clusters
    .map((c) => {
      // Seviye: tazeliğe göre ağırlıklı ortalama (son dokunuşlar daha belirleyici)
      const weights = c.map((p) => Math.pow(0.5, (n - 1 - p.index) / 250));
      const wSum = weights.reduce((a, b) => a + b, 0);
      const level = c.reduce((s, p, k) => s + p.price * weights[k], 0) / wSum;
      const lastIndex = Math.max(...c.map((p) => p.index));
      return { level, touches: c.length, daysSinceTouch: n - 1 - lastIndex };
    })
    // Tek dokunuşlu seviye ancak YAKIN tarihliyse anlamlıdır (son salınım dibi/tepesi
    // de bir destek/dirençtir). Eski tek dokunuşlar gürültüdür, elenir.
    .filter((l) => l.touches >= 2 || l.daysSinceTouch <= 60);
}

/**
 * Fiyat yapısı: tipik işlem bandı + en yakın destek/direnç seviyeleri.
 * "Hisse genelde 130–140 $ arasında geziyor ama şu an %12 aşağıda" cümlesini
 * sayısal olarak kuran katman. Yetersiz veride null döner.
 */
export function analyzePriceStructure(closes) {
  const n = closes.length;
  const price = closes[n - 1];
  const band = buildPriceBand(closes);
  if (!band || !price) return null;

  const levels = buildPivotLevels(closes);
  // Anlamlılık: çok dokunulan + yakın zamanda dokunulan seviyeler önce gelir
  const rank = (l) => l.touches + clamp01(1 - l.daysSinceTouch / 400) * 2;
  const fmtLevel = (l) => ({
    level: Number(l.level.toFixed(2)),
    touches: l.touches,
    daysSinceTouch: l.daysSinceTouch,
    distancePct: Number(((l.level / price - 1) * 100).toFixed(1)),
  });

  const supports = levels
    .filter((l) => l.level < price * 0.995)
    .sort((a, b) => b.level - a.level) // fiyata en yakın destek önce
    .slice(0, 4)
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, 2)
    .sort((a, b) => b.level - a.level)
    .map(fmtLevel);

  const resistances = levels
    .filter((l) => l.level > price * 1.005)
    .sort((a, b) => a.level - b.level) // fiyata en yakın direnç önce
    .slice(0, 4)
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, 2)
    .sort((a, b) => a.level - b.level)
    .map(fmtLevel);

  const pctVsBandMid = Number(((price / band.mid - 1) * 100).toFixed(1));
  const bandPosition =
    price < band.low ? 'below' : price > band.high ? 'above' : 'inside';

  return {
    bandLow: Number(band.low.toFixed(2)),
    bandMid: Number(band.mid.toFixed(2)),
    bandHigh: Number(band.high.toFixed(2)),
    bandDays: band.days,
    pctVsBandMid,
    pctVsBandLow: Number(((price / band.low - 1) * 100).toFixed(1)),
    pctVsBandHigh: Number(((price / band.high - 1) * 100).toFixed(1)),
    bandPosition,
    supports,
    resistances,
    nearestSupport: supports[0] ?? null,
    nearestResistance: resistances[0] ?? null,
  };
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
    priceStructure: analyzePriceStructure(closes),
  };
}

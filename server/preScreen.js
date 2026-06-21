/**
 * Faz 1 ön-eleme: ~6000 ABD hissesinden derin analize değer ~300 hisseyi seçer.
 *
 * YALNIZCA toplu `quote` çağrısının döndürdüğü alanları kullanır (ek ağır çağrı
 * YOK): fiyat, 50/200 günlük ortalama, 52 hafta aralığı, hacim, piyasa değeri,
 * günlük değişim. Böylece tüm evren saniyeler içinde, ucuza taranır.
 *
 * Seçim, iki sıralamanın BİRLEŞİMİDİR ki hem kısa hem uzun vade için aday kalsın:
 *   1. Aktivite/momentum skoru en yüksekler (kısa vade fırsat zengini)
 *   2. Piyasa değeri en büyükler (köklü şirketler → uzun vade/değer adayları)
 * Salt momentumla seçseydik, ortalamaların altında seyreden iyi değer hisseleri
 * havuza hiç giremezdi.
 */

/** Likidite tabanı: bu eşiklerin altındaki hisseler derin analize alınmaz. */
export const MIN_MARKET_CAP = 300e6; // $300M
export const MIN_AVG_VOLUME = 100_000; // günlük ortalama hacim
export const MIN_PRICE = 1; // penny hisse elemesi

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pctAbove = (a, b) => (a && b ? (a / b - 1) * 100 : 0);

/** Toplu quote alanlarından ortalama günlük hacmi seçer (3 aylık öncelikli). */
function avgVolumeOf(q) {
  return q.averageDailyVolume3Month ?? q.averageDailyVolume10Day ?? 0;
}

/** Likidite/kalite tabanını geçiyor mu? */
export function isEligible(q) {
  if (!q) return false;
  const price = q.regularMarketPrice;
  const mcap = q.marketCap;
  return (
    price != null &&
    price > MIN_PRICE &&
    mcap != null &&
    mcap >= MIN_MARKET_CAP &&
    avgVolumeOf(q) >= MIN_AVG_VOLUME
  );
}

/**
 * Quote alanlarından kaba aktivite/momentum skoru. Kesin olması gerekmez —
 * yalnızca "derin analize değer mi" kararını verecek kadar ayırt edici olmalı.
 */
export function activityScore(q) {
  const price = q.regularMarketPrice;
  const ma50 = q.fiftyDayAverage;
  const ma200 = q.twoHundredDayAverage;
  const chg = q.regularMarketChangePercent ?? 0;
  const vol = q.regularMarketVolume;
  const avgVol = avgVolumeOf(q);
  const high52 = q.fiftyTwoWeekHigh;
  const low52 = q.fiftyTwoWeekLow;

  let s = 0;
  if (price && ma50) s += clamp(pctAbove(price, ma50), -20, 20) * 1.0; // kısa vade trend
  if (price && ma200) s += clamp(pctAbove(price, ma200), -25, 25) * 0.6; // uzun vade trend
  s += clamp(chg, -10, 10) * 0.8; // günlük momentum
  if (vol && avgVol) s += clamp((vol / avgVol - 1) * 100, -50, 150) * 0.2; // hacim patlaması
  if (price && high52 && low52 && high52 > low52) {
    const pos = (price - low52) / (high52 - low52); // 0=dip, 1=zirve
    s += (pos - 0.5) * 20; // zirveye yakınlık güç sinyali
  }
  return s;
}

/**
 * Quote dizisinden derin analiz havuzunu seçer.
 * @param quotes Yahoo quote nesneleri (mapQuote'tan ÖNCEKİ ham quote — ek alanlar gerekir)
 * @param total Hedef havuz boyutu (varsayılan 300)
 * @param momentumShare Havuzun aktivite sıralamasından gelecek oranı (kalanı piyasa değeri)
 * @returns seçilen sembol dizisi
 */
export function selectDeepPool(quotes, { total = 300, momentumShare = 0.6 } = {}) {
  const eligible = (quotes ?? []).filter(isEligible);
  if (eligible.length <= total) return eligible.map((q) => q.symbol);

  const momentumCount = Math.round(total * momentumShare);
  const selected = new Set();

  // 1. Aktivite/momentum en yüksekler
  [...eligible]
    .sort((a, b) => activityScore(b) - activityScore(a))
    .slice(0, momentumCount)
    .forEach((q) => selected.add(q.symbol));

  // 2. Kalan kontenjanı en büyük piyasa değerleriyle doldur (uzun vade adayları)
  for (const q of [...eligible].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))) {
    if (selected.size >= total) break;
    selected.add(q.symbol);
  }

  return [...selected];
}

/**
 * Fiyat seviyelerini SADE DİLE çeviren katman.
 *
 * `analyzePriceStructure` (server/technicalAnalysis.js) doğru sayıları
 * üretiyordu ama arayüz bunları "destek 128,50 · %-3,2 · 4 dokunuş" gibi
 * teknik bir tabloya döküyordu; kullanıcı bakınca ne yapması gerektiğini
 * çıkaramıyordu. Burada aynı sayılardan üç somut cevap üretilir:
 *
 *   1. Aşağıda hangi seviyeler tutar?      (destekler + ne kadar test edilmiş)
 *   2. Yukarıda hangi seviyeler zorlar?    (dirençler + hedef mesafesi)
 *   3. Hangi fiyattan almak mantıklı?      (destek üstü giriş bölgesi)
 *
 * Ayrıca "bu kurulum ne zaman bozulur" seviyesi verilir — bir alım fikrinin
 * en önemli parçası, yanlış çıktığında nerede kabul edileceğidir.
 *
 * Not: Buradaki hiçbir sayı tavsiye değildir; hepsi geçmiş fiyat davranışının
 * tarifidir. "Şu seviye 4 kez tutmuş" bir gözlemdir, garanti değil.
 */

/** Giriş bölgesinin destek üstünde kapsadığı tampon (%). */
const ENTRY_BUFFER_PCT = 3.5;
/** Kurulumun bozulduğu kabul edilen, desteğin altındaki pay (%). */
const INVALIDATION_PCT = 3;
/** Fiyat, giriş bölgesinin bu kadar üstündeyse "beklemeli" sayılır (%). */
const WAIT_TOLERANCE_PCT = 1.5;

const pct = (from, to) => ((to / from - 1) * 100);

/**
 * Bir destek/direnç seviyesini "kaç kez test edildi, ne kadar güvenilir"
 * cümlesine çevirir. Çok dokunulan seviye daha anlamlıdır: piyasa orayı
 * defalarca sınamış ve her seferinde tepki vermiştir.
 */
export function describeLevel(level, kind) {
  const touches = level.touches ?? 1;
  const distance = Math.abs(level.distancePct ?? 0);
  const direction = kind === 'support' ? 'altında' : 'üstünde';

  let confidence;
  if (touches >= 4) confidence = 'çok güçlü';
  else if (touches === 3) confidence = 'güçlü';
  else if (touches === 2) confidence = 'orta';
  else confidence = 'zayıf';

  const behaviour =
    kind === 'support'
      ? touches >= 2
        ? `geçmişte ${touches} kez bu seviyeye inildi ve her seferinde tepki geldi`
        : 'yakın tarihli tek bir dip; henüz doğrulanmadı'
      : touches >= 2
        ? `geçmişte ${touches} kez denendi ama geçilemedi`
        : 'yakın tarihli tek bir tepe; henüz doğrulanmadı';

  return {
    confidence,
    touches,
    // "Bugünkü fiyatın %6,2 altında" — mesafeyi işaretsiz ve okunur ver
    distanceText: `bugünkü fiyatın %${distance.toFixed(1)} ${direction}`,
    behaviourText: behaviour,
  };
}

/**
 * Giriş bölgesi + bozulma seviyesi üretir.
 *
 * Mantık: en iyi giriş, GÜÇLÜ bir desteğin hemen üstüdür — orada aşağı risk
 * ölçülebilir (destek kırılırsa fikir yanlıştır) ve yukarı alan açıktır.
 * Belirgin destek yoksa tipik işlem bandının alt sınırı kullanılır; bandın
 * altı, hissenin "normalde ucuz" saydığı bölgedir.
 */
export function buildEntryPlan(structure, price) {
  if (!structure || !price) return null;

  const { supports = [], bandLow } = structure;

  // Dayanak seçimi: EN YAKIN "yeterince güçlü" (≥3 dokunuş) destek.
  // En çok dokunulanı seçmek yanlış olurdu — 6 kez tutmuş ama %10 aşağıdaki bir
  // seviye, kullanıcıya gerçekleşmesi aylar sürebilecek bir bekleme önerir.
  // Yakınlık, kararı uygulanabilir kılan şeydir; güç ise eşikle sağlanır.
  const byProximity = [...supports].sort((a, b) => b.level - a.level); // fiyata en yakın önce
  const anchor =
    byProximity.find((s) => (s.touches ?? 0) >= 3) ??
    [...supports].sort((a, b) => (b.touches ?? 0) - (a.touches ?? 0))[0];

  const base = anchor?.level ?? bandLow;
  if (!base) return null;

  const low = base;
  // Bölge, desteğin hemen üstündeki tampon. Bugünkü fiyatla kırpılmaz: fiyat
  // bölgenin üstündeyse bunu `status` söyler — aralığı fiyata yapıştırmak
  // "her an alınabilir" izlenimi verirdi.
  const high = base * (1 + ENTRY_BUFFER_PCT / 100);

  const distanceToZonePct = pct(high, price); // fiyat bölgenin ne kadar üstünde
  const status =
    price <= high
      ? 'inside' // fiyat zaten giriş bölgesinde
      : distanceToZonePct <= WAIT_TOLERANCE_PCT
        ? 'near' // bölgenin hemen üstünde
        : 'above'; // geri çekilme beklemek gerekir

  return {
    low: Number(low.toFixed(2)),
    high: Number(Math.max(high, low * 1.005).toFixed(2)),
    anchorTouches: anchor?.touches ?? null,
    anchorIsSupport: Boolean(anchor),
    status,
    distanceToZonePct: Number(distanceToZonePct.toFixed(1)),
    // Kurulumun bozulduğu seviye: dayanak desteğin %3 altı
    invalidation: Number((base * (1 - INVALIDATION_PCT / 100)).toFixed(2)),
  };
}

/** Giriş bölgesi durumunun tek cümlelik açıklaması. */
export function getEntryStatusText(plan) {
  if (!plan) return null;
  if (plan.status === 'inside') {
    return 'Fiyat şu anda bu bölgenin içinde — seviye açısından giriş için uygun aralıkta.';
  }
  if (plan.status === 'near') {
    return `Fiyat bölgenin hemen üstünde (%${plan.distanceToZonePct}); küçük bir geri çekilme bölgeye sokar.`;
  }
  return `Fiyat bu bölgenin %${plan.distanceToZonePct} üstünde — seviyeden girmek için geri çekilme beklemek gerekir.`;
}

/** Fiyatın tipik banda göre konumunu sade dille anlatır. */
export function getBandPositionText(structure) {
  if (!structure) return null;
  const { bandPosition, pctVsBandMid } = structure;
  const abs = Math.abs(pctVsBandMid ?? 0).toFixed(1);
  if (bandPosition === 'below') {
    return `Şu anki fiyat, bu bandın ortasının %${abs} ALTINDA — hisse kendi normaline göre ucuz tarafta.`;
  }
  if (bandPosition === 'above') {
    return `Şu anki fiyat, bandın ortasının %${abs} ÜSTÜNDE — hisse kendi normaline göre pahalı tarafta.`;
  }
  return `Şu anki fiyat bandın içinde (ortaya göre %${pctVsBandMid > 0 ? '+' : ''}${pctVsBandMid}) — normal aralığında.`;
}

/**
 * Haber sinyalleri — KURAL TABANLI (AI YOK, maliyet SIFIR).
 *
 * Önceden her haber başlığı Claude Haiku'ya gönderilip duygu/güvenilirlik/özet
 * üretiliyordu. Tüm ABD taraması (300 sembol) haber tablosunu sürekli beslediği
 * için bu iş bitmeyen bir kuyruğa dönüştü ve günde ~$3-5 yakmaya başladı.
 * Haber listesi için AI'ın kattığı değer bu maliyeti karşılamıyordu: kullanıcı
 * haber sayfasında ton ve kaynak kalitesini görmek istiyor, edebi özet değil.
 *
 * Bu modül aynı iki alanı (sentiment + reliability) sözlük/kalıp eşlemesiyle
 * üretir. AI bütçesi artık YALNIZCA Fırsatlar'daki "kesin yargı" katmanına
 * ayrılıyor (bkz. server/convictionAnalysis.js) — yani binlerce başlık yerine
 * turda birkaç düzine finalist adaya.
 *
 * Not: Kalıplar hem Türkçe (BIST) hem İngilizce (ABD) başlıklar için yazılmıştır;
 * ABD başlıkları çeviriden ÖNCEKİ orijinal haliyle de eşleşebilsin diye iki dil
 * aynı listede tutulur.
 */

/** Yayıncı adı → güvenilirlik (1-10). İlk eşleşen kazanır, sıralama önemlidir. */
const PUBLISHER_RELIABILITY = [
  [/reuters|bloomberg|associated press|\bap\b|wall street journal|financial times|\bkap\b|\bsec\b|matriks/i, 9],
  [/globenewswire|business wire|pr newswire|anadolu ajans|\baa\b/i, 8],
  [/yahoo|cnbc|barron|marketwatch|investing|forbes|ekonomim|dünya|bloomberght|bigpara|foreks/i, 7],
  [/zacks|motley fool|simply wall|benzinga|insider monkey|seeking alpha|paratic|mynet|borsagundem/i, 6],
];

/** Yayıncı adından güvenilirlik tahmini (1-10). Bilinmeyen kaynak → 5 (nötr). */
export function estimatePublisherReliability(publisher = '') {
  for (const [pattern, score] of PUBLISHER_RELIABILITY) {
    if (pattern.test(publisher)) return score;
  }
  return 5;
}

/** Yayıncıyı kaynak türüne sınıflar (detay modalındaki "kaynak tipi" rozeti). */
export function classifySource(publisher = '') {
  if (/kap|sec|globenewswire|business wire|pr newswire/i.test(publisher)) return 'Resmi Bildirim';
  if (/reuters|bloomberg|associated press|anadolu/i.test(publisher)) return 'Haber Ajansı';
  if (/zacks|motley fool|simply wall|benzinga|insider monkey|seeking alpha/i.test(publisher))
    return 'Analiz / Araştırma';
  return 'Finans Medyası';
}

/**
 * Fiyatı YUKARI yönlü etkileme ihtimali yüksek kalıplar.
 * Ağırlık (2) = güçlü/somut olay, (1) = destekleyici ton.
 */
const POSITIVE_PATTERNS = [
  // --- Somut olaylar (güçlü) ---
  [/\b(beat|beats|topped|tops)\b.{0,25}\b(estimate|expectation|forecast|consensus)/i, 2],
  [/beklenti(?:lerin|nin)? (üzerinde|üstünde)|beklentileri aştı/i, 2],
  [/\braise[sd]?\b.{0,25}\b(guidance|outlook|forecast|target|dividend)/i, 2],
  [/(hedef fiyat|beklenti|tahmin|temettü)[^.]{0,25}(yükselt|artır|yukarı çek)/i, 2],
  [/\b(upgrade[sd]?|outperform|overweight)\b/i, 2],
  [/(not(?:unu)?|derecesi(?:ni)?)[^.]{0,20}yükselt/i, 2],
  [/\b(wins?|won|awarded|secures?|lands?)\b.{0,35}\b(contract|order|deal|tender|bid)/i, 2],
  [/(yeni )?(sözleşme|anlaşma|sipariş|ihale)[^.]{0,20}(imzala|kazan|aldı|alındı)/i, 2],
  [/\b(acquisition|acquires?|merger|takeover|buyout)\b/i, 2],
  [/(satın al(?:ma|ım|acak|dı)|birleşme|devral)/i, 2],
  [/\b(buyback|repurchase)\b/i, 2],
  [/(hisse )?geri alım/i, 2],
  [/\b(fda|ema)\b.{0,25}\b(approv|clearance)/i, 2],
  [/\b(approval|approved|authorized)\b/i, 1],
  [/(onay(?:ı|landı|ladı)|ruhsat|izin aldı)/i, 1],
  [/\brecord\b.{0,20}\b(revenue|profit|earnings|orders|backlog|sales)/i, 2],
  [/rekor (kar|kâr|gelir|sipariş|ihracat|satış)/i, 2],
  [/\b(expands?|expansion|new plant|capacity increase)\b/i, 1],
  [/(kapasite art|yeni (fabrika|tesis|yatırım)|üretim art)/i, 1],
  [/(bedelsiz|sermaye artırımı|temettü (kararı|açıkla|dağıt))/i, 1],
  // --- Ton (destekleyici) ---
  [/\b(surge[sd]?|soar[sd]?|jump[sd]?|rally|rallies|climbs?|gains?|advance[sd]?)\b/i, 1],
  [/(yükseldi|yükseliyor|yükseliş|ralli|sıçra|prim yaptı|değer kazandı|zirve)/i, 1],
  [/(tavan (oldu|yaptı|fiyat)|para giriş|alım ilgisi|talep gördü)/i, 1],
  [/\b(strong|robust|better[- ]than[- ]expected|bullish|optimistic)\b/i, 1],
  [/(güçlü|olumlu|pozitif ayrış|iyimser)/i, 1],
];

/** Fiyatı AŞAĞI yönlü etkileme ihtimali yüksek kalıplar. */
const NEGATIVE_PATTERNS = [
  // --- Somut olaylar (güçlü) ---
  [/\b(miss(?:es|ed)?|fell short)\b.{0,25}\b(estimate|expectation|forecast|consensus)/i, 2],
  [/beklenti(?:lerin|nin)? (altında|gerisinde)|beklentileri karşılamadı/i, 2],
  [/\b(cuts?|lowers?|slashe[sd]?)\b.{0,25}\b(guidance|outlook|forecast|target|dividend)/i, 2],
  [/(hedef fiyat|beklenti|tahmin|temettü)[^.]{0,25}(düşür|indir|azalt|aşağı çek)/i, 2],
  [/\b(downgrade[sd]?|underperform|underweight)\b/i, 2],
  [/(not(?:unu)?|derecesi(?:ni)?)[^.]{0,20}(düşür|indir)/i, 2],
  [/\b(lawsuit|sued?|sues|investigation|probe|fraud|subpoena)\b/i, 2],
  [/(dava|soruşturma|inceleme başlat|ceza kesildi|dolandırıcılık|suçlama)/i, 2],
  [/\b(recall|halt(?:s|ed)?|suspend(?:s|ed)?|ban(?:s|ned)?|delisting)\b/i, 2],
  [/(geri çağır|üretim durdur|işlem (durdur|kapatıl)|yasak|tedbir kararı)/i, 2],
  [/\b(bankrupt|insolvency|default|chapter 11|restructuring)\b/i, 2],
  [/(iflas|konkordato|borç yapılandır|temerrüt)/i, 2],
  [/\b(layoffs?|job cuts?|plant closure)\b/i, 1],
  [/(işten çıkar|kapanış kararı|küçülme)/i, 1],
  [/\b(loss|deficit|write[- ]?down|impairment)\b/i, 1],
  [/(zarar açıkla|değer düşüklüğü|maliyet baskısı|marj daral)/i, 1],
  // --- Ton (destekleyici) ---
  [/\b(plunge[sd]?|tumble[sd]?|sink[s]?|slump[sd]?|crash(?:es|ed)?|slide[sd]?|drops?|falls?|declin(?:e|es|ed))\b/i, 1],
  [/(düştü|düşüyor|düşüş|geriledi|geriliyor|sert kayıp|değer kaybetti|çakıldı|satış baskısı)/i, 1],
  [/(taban (oldu|fiyat)|devre kesti|kar satış)/i, 1],
  [/\b(weak|disappointing|worse[- ]than[- ]expected|bearish|concerns?|warning)\b/i, 1],
  [/(zayıf|olumsuz|endişe|uyarı|riski artıyor|negatif ayrış)/i, 1],
];

/** Toplam ağırlık farkının "kararlı" sayılması için gereken minimum fark. */
const DECISION_MARGIN = 1;

/**
 * Başlığı duyguya çevirir. AI'ın yerini alır: kalıp ağırlıklarının toplamı
 * karşılaştırılır, aradaki fark eşiğin altındaysa (veya hiç eşleşme yoksa)
 * "neutral" döner — yani emin olunamayan başlıklar iddialı etiketlenmez.
 *
 * @returns {{ sentiment: 'positive'|'negative'|'neutral', strength: number }}
 *   strength: kazanan tarafın toplam ağırlığı (0 = sinyal yok). Kanıt motoru
 *   bunu olayın "sertliği" için kullanır.
 */
export function classifyHeadline(title = '') {
  if (!title) return { sentiment: 'neutral', strength: 0 };

  let positive = 0;
  let negative = 0;
  for (const [pattern, weight] of POSITIVE_PATTERNS) {
    if (pattern.test(title)) positive += weight;
  }
  for (const [pattern, weight] of NEGATIVE_PATTERNS) {
    if (pattern.test(title)) negative += weight;
  }

  const diff = positive - negative;
  if (diff >= DECISION_MARGIN) return { sentiment: 'positive', strength: positive };
  if (-diff >= DECISION_MARGIN) return { sentiment: 'negative', strength: negative };
  return { sentiment: 'neutral', strength: 0 };
}

/**
 * Bir haber satırı için Supabase'e yazılacak sinyal alanlarını üretir.
 * ai_summary_tr BİLEREK doldurulmaz: başlıktan üretilen "özet" başlığın
 * kendisinin kopyası olurdu; arayüz özet yoksa başlığı gösteriyor.
 */
export function buildNewsSignals({ title, publisher }) {
  const { sentiment } = classifyHeadline(title);
  return { sentiment, reliability: estimatePublisherReliability(publisher) };
}

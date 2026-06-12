/**
 * Haber sinyal yardımcıları.
 * detectCatalyst: başlıkta ileriye dönük, fiyatı olumlu etkileyebilecek
 * bir gelişme var mı? (hedef fiyat artışı, yeni sözleşme, satın alma...)
 * Bilinçli olarak SEÇİCİ tutulur — sayfanın her yeri turuncu olmasın diye
 * yalnızca güçlü katalizör kalıpları eşleşir. AI analiz motoru bağlandığında
 * bu sezgisel yöntemin yerini model çıktısı alacaktır.
 */

const CATALYST_PATTERNS = [
  // Türkçe kalıplar
  /hedef fiyat/i,
  /yükseltti/i,
  /rekor (kar|kâr|gelir|sipariş|ihracat)/i,
  /yeni (sözleşme|anlaşma|sipariş|ihale)/i,
  /sözleşme imzala/i,
  /anlaşma imzala/i,
  /satın al(ma|ım|acak)/i,
  /ortaklık (kurdu|anlaşması)/i,
  /kapasite art(ışı|ırıyor)/i,
  /bedelsiz/i,
  /temettü (kararı|açıkla|dağıt)/i,
  /teşvik paketi/i,
  /beklentilerin üzerinde/i,
  /beklentileri aştı/i,
  // İngilizce kalıplar (orijinal başlıklar için)
  /price target (raise|increase|boost)/i,
  /raises? (price target|guidance|outlook|forecast)/i,
  /upgrade[ds]?/i,
  /beats? (estimates|expectations)/i,
  /(wins?|awarded|secures?) .{0,30}(contract|order|deal)/i,
  /new (contract|partnership|order)/i,
  /acquisition/i,
  /record (revenue|profit|earnings|orders)/i,
  /approval/i,
  /expands? (production|capacity)/i,
];

/**
 * Haberin "gelecekte fiyatı olumlu etkileyebilecek katalizör" içerip
 * içermediğini tahmin eder. Negatif duygulu haberler asla işaretlenmez.
 */
export function detectCatalyst(news) {
  if (news.sentiment === 'negative') return false;
  const text = `${news.title ?? ''} ${news.originalTitle ?? ''}`;
  return CATALYST_PATTERNS.some((pattern) => pattern.test(text));
}

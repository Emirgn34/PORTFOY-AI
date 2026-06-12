/**
 * Mock analiz verisi.
 * İleride gerçek AI analiz servisi bağlandığında bu dosyanın yerini
 * aynı şemayı döndüren bir servis katmanı (ör. src/services/analysisService.js)
 * alacaktır. Arayüz bileşenleri sadece bu şemaya bağımlıdır.
 */

/** Portföy geneli mock skorları. */
export const MOCK_PORTFOLIO_ANALYSIS = {
  overallScore: 72,
  riskLevel: 'Orta',
  diversificationScore: 61,
  newsImpactScore: 74,
  fundamentalScore: 78,
  technicalScore: 66,
  comment:
    'Portföy genel olarak güçlü temellere sahip şirketlerden oluşuyor. Savunma ve teknoloji ağırlığı getiri potansiyelini desteklerken, sektör çeşitlendirmesi sınırlı kaldığı için yoğunlaşma riski mevcut. Haber akışı ağırlıklı olarak pozitif; ancak tek sektöre bağımlılığı azaltmak çeşitlendirme skorunu iyileştirebilir.',
};

/** Bilinen hisseler için elle hazırlanmış mock analizler. */
const KNOWN_STOCK_ANALYSES = {
  THYAO: {
    overallScore: 78,
    riskScore: 55,
    returnPotential: 76,
    newsSensitivity: 68,
    reliableNewsAvg: 8.6,
    recommendation: 'Güçlü',
    comment:
      'Trafik verileri ve filo yatırımları büyüme hikayesini destekliyor. Yakıt maliyeti ve kur duyarlılığı temel risk unsurları.',
  },
  ASELS: {
    overallScore: 81,
    riskScore: 48,
    returnPotential: 80,
    newsSensitivity: 72,
    reliableNewsAvg: 7.7,
    recommendation: 'Güçlü',
    comment:
      'Rekor bakiye siparişler ve ihracat sözleşmeleri görünürlüğü artırıyor. Yüksek çarpanlar kısa vadede dalgalanma yaratabilir.',
  },
  SISE: {
    overallScore: 47,
    riskScore: 64,
    returnPotential: 52,
    newsSensitivity: 58,
    reliableNewsAvg: 7.5,
    recommendation: 'İzlenmeli',
    comment:
      'Avrupa talep zayıflığı ve kapasite azaltımı kısa vadeli baskı yaratıyor. Geri dönüşüm yatırımları uzun vadede maliyet avantajı sağlayabilir.',
  },
  AAPL: {
    overallScore: 66,
    riskScore: 42,
    returnPotential: 60,
    newsSensitivity: 55,
    reliableNewsAvg: 5.5,
    recommendation: 'Nötr',
    comment:
      'Hizmet gelirleri güçlü seyrediyor ancak yapay zeka ürün gecikmeleri rekabet algısını zayıflatıyor. Dengeli görünüm.',
  },
  MSFT: {
    overallScore: 84,
    riskScore: 38,
    returnPotential: 78,
    newsSensitivity: 50,
    reliableNewsAvg: 8.5,
    recommendation: 'Güçlü',
    comment:
      'Bulut ve yapay zeka yatırımları büyümeyi destekliyor. AB incelemesi izlenmesi gereken düzenleyici bir risk.',
  },
};

/** Ticker'dan deterministik sayı üretir (bilinmeyen hisseler için tutarlı mock skor). */
function hashTicker(ticker) {
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) {
    hash = (hash * 31 + ticker.charCodeAt(i)) % 1000;
  }
  return hash;
}

function deriveRecommendation(overallScore, riskScore) {
  if (riskScore >= 70) return 'Riskli';
  if (overallScore >= 75) return 'Güçlü';
  if (overallScore >= 55) return 'İzlenmeli';
  return 'Nötr';
}

/**
 * Bir hisse için mock analiz döndürür. Bilinen hisselerde elle yazılmış
 * veri, diğerlerinde ticker'a göre deterministik üretilmiş skorlar kullanılır.
 */
export function getStockAnalysis(ticker) {
  const known = KNOWN_STOCK_ANALYSES[ticker];
  if (known) return known;

  const h = hashTicker(ticker.toUpperCase());
  const overallScore = 35 + (h % 56); // 35-90 arası
  const riskScore = 30 + ((h * 7) % 56);
  const returnPotential = 35 + ((h * 13) % 56);
  const newsSensitivity = 30 + ((h * 17) % 61);
  const reliableNewsAvg = Math.round((4 + ((h * 3) % 60) / 10) * 10) / 10; // 4.0-9.9

  return {
    overallScore,
    riskScore,
    returnPotential,
    newsSensitivity,
    reliableNewsAvg,
    recommendation: deriveRecommendation(overallScore, riskScore),
    comment:
      'Bu hisse için detaylı AI analizi henüz hazırlanmadı. Skorlar örnek verilerle oluşturulmuştur; analiz motoru bağlandığında gerçek değerlendirme burada görünecek.',
  };
}

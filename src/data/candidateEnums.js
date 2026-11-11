/**
 * Aday kartlarının GERÇEK (üretimde kullanılan) sabitleri.
 *
 * Bu değerler eskiden mockShortTermCandidates.js içindeydi; üretim kodunun
 * "mock" adlı bir modüle bağımlı olmaması ve mock dosyalarının dinamik
 * (yalnızca MOCK_ENABLED iken) yüklenebilmesi için buraya taşındı.
 */

export const RISK_LEVELS = ['Düşük', 'Orta', 'Yüksek'];
export const LIQUIDITY_LEVELS = ['Düşük', 'Orta', 'Yüksek'];

/** Sıralama için sinyal/enum ağırlıkları. */
export const VOLUME_SIGNAL_ORDER = {
  'Güçlü Hacim Artışı': 4,
  'Hacim Artışı': 3,
  'Normal Hacim': 2,
  'Zayıf Hacim': 1,
};

export const RISK_ORDER = { 'Düşük': 1, 'Orta': 2, 'Yüksek': 3 };

/** Haber türü filtresinin gerçek seçenekleri (eski yeri: mockNews.js). */
export const NEWS_TYPES = ['Anlaşma', 'Bilanço', 'Yatırım', 'Ortaklık', 'KAP', 'Genel Haber'];

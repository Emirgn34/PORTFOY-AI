/**
 * BIST tarama evreni.
 *
 * Kaynak: KAP'in resmi "Endeksler" PDF'i, BIST 100 bölümü.
 * https://kap.org.tr/tr/api/company/indices/pdf/endeksler
 *
 * KAP endeks bileşenlerini dönemsel olarak değiştirdiği için tarih özellikle
 * tutulur. Liste Yahoo Finance sembol biçimindedir; toplayıcı doğrudan
 * kullanabilir. Eski aday üreticisi yalnızca 14 BIST hissesini tarıyordu.
 */
export const BIST_UNIVERSE_SOURCE = {
  name: 'KAP - BIST 100',
  url: 'https://kap.org.tr/tr/api/company/indices/pdf/endeksler',
  verifiedAt: '2026-08-09',
};

export const BIST_100_TICKERS = [
  'AKBNK', 'AKSA', 'AKSEN', 'ALARK', 'ALTNY', 'ANSGR', 'AEFES', 'ARCLK', 'ASELS', 'ASTOR',
  'BALSU', 'BTCIM', 'BSOKE', 'BERA', 'BIMAS', 'BRSAN', 'BRYAT', 'CCOLA', 'CVKMD', 'CWENE',
  'CANTE', 'CIMSA', 'DAPGM', 'DSTKF', 'DOHOL', 'DOAS', 'EFOR', 'ECILC', 'EKGYO', 'ENJSA',
  'ENERY', 'ENKAI', 'EREGL', 'ESEN', 'EUREN', 'EUPWR', 'FENER', 'FROTO', 'GSRAY', 'GENIL',
  'GESAN', 'GRTHO', 'GUBRF', 'GLRMK', 'GRSEL', 'SAHOL', 'HEKTS', 'IEYHO', 'ISMEN', 'IZENR',
  'KRDMD', 'KTLEV', 'KLRHO', 'KCHOL', 'KUYAS', 'MAGEN', 'MAVI', 'MIATK', 'MGROS', 'MPARK',
  'OBAMS', 'ODAS', 'ODINE', 'OTKAR', 'OYAKC', 'PASEU', 'PSGYO', 'PAHOL', 'PATEK', 'PGSUS',
  'PETKM', 'QUAGR', 'RALYH', 'REEDR', 'SARKY', 'SASA', 'SKBNK', 'SOKM', 'TAVHL', 'TKFEN',
  'TOASO', 'TRMET', 'TRENJ', 'TUKAS', 'TCELL', 'TUPRS', 'TRALT', 'THYAO', 'GARAN', 'HALKB',
  'ISCTR', 'TSKB', 'TURSG', 'SISE', 'VAKBN', 'TTKOM', 'ULKER', 'VESTL', 'YKBNK', 'ZOREN',
];

export const BIST_100_SYMBOLS = BIST_100_TICKERS.map((ticker) => `${ticker}.IS`);

// KAP'ın dönem geçişlerinde PDF ve dinamik Endeksler görünümü kısa süre farklı
// snapshot gösterebiliyor. Son resmî görünümde yer alan fakat PDF snapshot'ında
// bulunmayan üyeleri küçük bir tamponda tutarak bu geçişte fırsat kaçırmayız.
export const BIST_COMPONENT_BUFFER = ['AGHOL'];
export const BIST_SCAN_SYMBOLS = [
  ...new Set([...BIST_100_TICKERS, ...BIST_COMPONENT_BUFFER]),
].map((ticker) => `${ticker}.IS`);

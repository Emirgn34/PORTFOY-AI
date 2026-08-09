/**
 * Uygulama geneli yapılandırma bayrakları.
 *
 * MOCK_ENABLED: demo (mock) verilerin gerçek veri yerine gösterilmesine izin
 * verilir mi? Yerel geliştirmede açık, production'da kapalıdır.
 *
 * DİKKAT: Bu bayrak kapalıyken "veri her zaman vardır" varsayımı çöker —
 * gerçek veri yolları null dönebilir ve tüketiciler buna hazır olmalıdır.
 * Bayrak tek bir yerde tanımlıdır ki testler production davranışını
 * (MOCK_ENABLED=false) açıkça doğrulayabilsin.
 */
export const MOCK_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCK_DATA === 'true';

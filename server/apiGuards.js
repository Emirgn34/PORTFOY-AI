/**
 * Vercel API uçlarının ortak koruması.
 *
 * api/ altındaki Yahoo tabanlı uçlar (quotes, history, fx, search, profile)
 * kimliksiz çalışır; koruma olmadan tek istekte yüzlerce sembol Yahoo'ya
 * yayılabilir ve uçlar dışarıdan ücretsiz fiyat proxy'si olarak kullanılabilir
 * — Vercel çağrı kotası yanar, Yahoo deployment IP'sini kısıtlar.
 * Bu yüzden üç kural her uçta birden uygulanır:
 *   1. Sembol biçimi doğrulanır (serbest metin Yahoo'ya iletilmez),
 *   2. Sembol sayısı sınırlanır (bir portföy için 25 fazlasıyla yeter),
 *   3. CDN önbellek başlığı konur (aynı veriyi herkese tekrar tekrar çekmeyiz).
 * Karşılaştırma için: api/sec-filings.js ve api/market-intelligence.js zaten
 * aynı deseni uyguluyordu; bu modül deseni tek yere toplar.
 */

/** Yahoo sembol biçimi (THYAO.IS, BRK-B, USDTRY=X). En fazla 15 karakter. */
export const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.\-=]{0,14}$/;

/** Virgüllü sembol listesini doğrular, tekilleştirir ve sınırlar. */
export function parseSymbols(raw, { limit = 25 } = {}) {
  return [
    ...new Set(
      String(raw ?? '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => SYMBOL_PATTERN.test(s))
    ),
  ].slice(0, limit);
}

/** Herkese aynı dönen veriler için CDN önbelleği (saniye cinsinden). */
export function setPublicCache(res, maxAge, staleWhileRevalidate) {
  res.setHeader(
    'Cache-Control',
    `public, s-maxage=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`
  );
}

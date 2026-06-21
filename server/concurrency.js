/**
 * Sınırlı eşzamanlılıkla iş çalıştırma yardımcısı.
 *
 * Sıralı (await zinciri) çalışan ağır I/O döngülerini (quoteSummary, geçmiş
 * grafik, RSS, çeviri) en fazla `limit` eşzamanlı istekle paralelleştirir.
 * Amaç: turu hızlandırmak ama veri kaynaklarını (Yahoo / Google) rate-limit'e
 * sokmayacak makul bir tavanda kalmak.
 */

/**
 * `items` üzerinde `fn`'i en fazla `limit` eşzamanlılıkla çalıştırır.
 * Sonuç dizisi giriş sırasını korur. fn(item, index) -> Promise.
 */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

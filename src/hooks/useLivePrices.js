import { useCallback, useEffect, useState } from 'react';
import { fetchLiveQuotes, fetchLiveFx } from '../services/liveData.js';
import { updateExchangeRates } from '../utils/portfolioCalculations.js';

/**
 * Portföy/izleme listesindeki hisselerin fiyatlarını canlı veri
 * sunucusundan günceller. Sunucu kapalıysa sessizce devre dışı kalır;
 * mevcut (manuel) fiyatlar korunur.
 *
 * autoRefreshMs verilirse o aralıkla otomatik yenilenir.
 */
export default function useLivePrices(stocks, setStocks, { autoRefreshMs = null } = {}) {
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isOffline, setIsOffline] = useState(false);

  const refresh = useCallback(async () => {
    if (!stocks?.length) return;
    setLoading(true);

    const [quotes, fx] = await Promise.all([fetchLiveQuotes(stocks), fetchLiveFx()]);
    if (fx) updateExchangeRates(fx);

    if (quotes) {
      setStocks((prev) =>
        prev.map((stock) => {
          const q = quotes.get((stock.ticker ?? '').toUpperCase());
          if (!q?.price) return stock;
          return {
            ...stock,
            currentPrice: q.price,
            dailyChangePercent:
              typeof q.changePercent === 'number'
                ? Number(q.changePercent.toFixed(2))
                : stock.dailyChangePercent,
          };
        })
      );
      setLastUpdated(new Date());
      setIsOffline(false);
    } else {
      setIsOffline(true);
    }
    setLoading(false);
  }, [stocks, setStocks]);

  // Sayfa açıldığında bir kez dene; istenirse aralıklı yenile
  useEffect(() => {
    refresh();
    if (!autoRefreshMs) return undefined;
    const timer = setInterval(refresh, autoRefreshMs);
    return () => clearInterval(timer);
    // refresh'i bilinçli olarak bağımlılığa eklemiyoruz: stok listesi her
    // güncellemede değiştiği için döngü oluşur; ilk yükleme + interval yeterli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { refresh, loading, lastUpdated, isOffline };
}

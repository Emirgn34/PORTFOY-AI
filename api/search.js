/**
 * Vercel sunucu fonksiyonu: hisse kodu/isim araması.
 * Lokal geliştirmede aynı işi server/index.js yapar; bu dosya sitenin
 * (Vercel) kendi başına çalışabilmesi içindir.
 */
import YahooFinance from 'yahoo-finance2';
import { mapExchangeToMarket } from '../server/marketData.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export default async function handler(req, res) {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 1) return res.status(200).json({ results: [] });

  try {
    const result = await yahooFinance.search(q, { quotesCount: 10, newsCount: 0 });
    const results = (result.quotes ?? [])
      .filter((item) => item.symbol && (item.quoteType === 'EQUITY' || item.quoteType === 'ETF'))
      .map((item) => ({
        symbol: item.symbol,
        ticker: item.symbol.replace(/\.IS$/, ''),
        name: item.shortname ?? item.longname ?? item.symbol,
        market: mapExchangeToMarket(item.symbol, item.exchDisp),
        quoteType: item.quoteType,
      }))
      .sort((a, b) => {
        const rank = (m) => (['BIST', 'NASDAQ', 'NYSE'].includes(m) ? 0 : 1);
        return rank(a.market) - rank(b.market);
      });
    res.status(200).json({ results });
  } catch (err) {
    console.error('[search]', err.message);
    res.status(200).json({ results: [] });
  }
}

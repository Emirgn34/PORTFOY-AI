/**
 * Vercel sunucu fonksiyonu: USD/TRY ve EUR/TRY kurları.
 */
import YahooFinance from 'yahoo-finance2';
import { FX_SYMBOLS } from '../server/marketData.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export default async function handler(_req, res) {
  try {
    const results = await yahooFinance.quote(FX_SYMBOLS);
    const list = Array.isArray(results) ? results : [results];
    const rates = {};
    for (const q of list) {
      if (q.symbol === 'USDTRY=X') rates.USD = q.regularMarketPrice;
      if (q.symbol === 'EURTRY=X') rates.EUR = q.regularMarketPrice;
    }
    res.status(200).json({ rates, fetchedAt: Date.now() });
  } catch (err) {
    console.error('[fx]', err.message);
    res.status(502).json({ error: 'Kur verisi alınamadı' });
  }
}

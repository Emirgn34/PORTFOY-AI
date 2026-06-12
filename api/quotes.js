/**
 * Vercel sunucu fonksiyonu: anlık fiyatlar (ABD + BIST).
 */
import YahooFinance from 'yahoo-finance2';
import { mapQuote } from '../server/marketData.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export default async function handler(req, res) {
  const symbols = String(req.query.symbols ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (symbols.length === 0) {
    return res.status(400).json({ error: 'symbols parametresi gerekli' });
  }

  try {
    const results = await yahooFinance.quote(symbols);
    const list = (Array.isArray(results) ? results : [results]).map((q) => ({
      ...mapQuote(q),
      fetchedAt: Date.now(),
    }));
    res.status(200).json({ quotes: list });
  } catch (err) {
    console.error('[quotes]', err.message);
    res.status(502).json({ error: 'Fiyat verisi alınamadı' });
  }
}

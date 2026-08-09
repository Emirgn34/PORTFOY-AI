import YahooFinance from 'yahoo-finance2';
import { getMarketIntelligence } from '../server/marketIntelligence.js';

export const maxDuration = 45;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Yöntem desteklenmiyor.' });
  const symbols = String(req.query.symbols ?? '')
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9.\-]+(?:\.IS)?$/.test(symbol))
    .slice(0, 20);
  if (!symbols.length) return res.status(400).json({ error: 'En az bir sembol gerekli.' });
  try {
    res.setHeader('Cache-Control', 'private, max-age=120, stale-while-revalidate=300');
    return res.status(200).json(
      await getMarketIntelligence(yahooFinance, symbols, {
        includeOptions: String(req.query.options ?? 'true') !== 'false',
      })
    );
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
}

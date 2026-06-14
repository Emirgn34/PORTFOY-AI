/**
 * Vercel sunucu fonksiyonu: dönemsel yüzde değişim (1g/1h/1a/3a/1y/3y/5y).
 * Portföy sayfasındaki "dönem K/Z" kartı bunu kullanır.
 */
import YahooFinance from 'yahoo-finance2';
import { computePeriodChanges } from '../server/marketData.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export default async function handler(req, res) {
  const symbols = String(req.query.symbols ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const range = String(req.query.range ?? '1mo');

  if (symbols.length === 0) {
    return res.status(400).json({ error: 'symbols parametresi gerekli' });
  }

  try {
    const changes = await computePeriodChanges(yahooFinance, symbols, range);
    res.status(200).json({ changes, range });
  } catch (err) {
    console.error('[history]', err.message);
    res.status(502).json({ error: 'Geçmiş veri alınamadı' });
  }
}

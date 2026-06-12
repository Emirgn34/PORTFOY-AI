/**
 * Vercel sunucu fonksiyonu: seçilen sembolün form doldurma profili
 * (şirket adı, pazar, para birimi, güncel fiyat, sektör).
 */
import YahooFinance from 'yahoo-finance2';
import { mapExchangeToMarket, SECTOR_TR } from '../server/marketData.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export default async function handler(req, res) {
  const symbol = String(req.query.symbol ?? '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol parametresi gerekli' });

  try {
    const q = await yahooFinance.quote(symbol);
    let sector = '';
    try {
      const summary = await yahooFinance.quoteSummary(symbol, { modules: ['assetProfile'] });
      const rawSector = summary.assetProfile?.sector;
      sector = SECTOR_TR[rawSector] ?? rawSector ?? '';
    } catch {
      // sektör opsiyonel
    }

    res.status(200).json({
      profile: {
        symbol: q.symbol,
        ticker: q.symbol.replace(/\.IS$/, ''),
        company: q.longName ?? q.shortName ?? q.symbol,
        market: mapExchangeToMarket(q.symbol, q.fullExchangeName),
        currency: q.currency ?? (q.symbol.endsWith('.IS') ? 'TRY' : 'USD'),
        currentPrice: q.regularMarketPrice ?? null,
        dailyChangePercent:
          typeof q.regularMarketChangePercent === 'number'
            ? Number(q.regularMarketChangePercent.toFixed(2))
            : null,
        sector,
      },
    });
  } catch (err) {
    console.error('[profile]', err.message);
    res.status(404).json({ error: 'Sembol bulunamadı' });
  }
}

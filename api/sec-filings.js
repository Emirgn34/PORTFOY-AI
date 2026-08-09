import { getCompanyFilings } from '../server/secData.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Yöntem desteklenmiyor.' });
  const symbol = String(req.query.symbol ?? '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol)) {
    return res.status(400).json({ error: 'Geçerli bir ABD hisse kodu gerekli.' });
  }
  const forms = String(req.query.forms ?? '10-K,10-Q,8-K').split(',').map((value) => value.trim());
  try {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json(await getCompanyFilings(symbol, { forms, limit: req.query.limit }));
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
}

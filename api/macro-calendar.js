import { getMacroCalendar } from '../server/macroCalendar.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Yöntem desteklenmiyor.' });
  try {
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(await getMacroCalendar({ days: req.query.days }));
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
}

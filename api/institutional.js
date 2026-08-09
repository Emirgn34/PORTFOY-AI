import { getInstitutionalMoves, INSTITUTIONAL_MANAGERS } from '../server/secData.js';

export const maxDuration = 30;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Yöntem desteklenmiyor.' });
  const manager = String(req.query.manager ?? '');
  if (!manager) return res.status(200).json({ managers: INSTITUTIONAL_MANAGERS });
  try {
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(await getInstitutionalMoves(manager, { limit: req.query.limit }));
  } catch (error) {
    return res.status(502).json({ error: error.message, managers: INSTITUTIONAL_MANAGERS });
  }
}

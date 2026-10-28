import { automationDb, checked } from './automationDb.js';
import { validCronSecret } from './cronAuth.js';
import { scanFreeNews } from './freeNews.js';
import { translateStoredCatalysts } from './catalystNews.js';
import { pushConfigured } from './pushNotifications.js';

export function createNewsScannerHandler({ getDb = automationDb, scan = scanFreeNews,
  translate = translateStoredCatalysts, env = process.env } = {}) {
  return async function newsScannerHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Yöntem desteklenmiyor.' });
    const expectedSecret = env.NEWS_CRON_SECRET ?? env.CRON_SECRET;
    if (!validCronSecret(req.headers?.['x-cron-secret'], expectedSecret)) {
      return res.status(401).json({ error: 'Geçersiz otomasyon kimliği.' });
    }
    try {
      const sb = getDb();
      if (req.body?.checkOnly === true) {
        const lock = checked(await sb.from('monitor_status').select('id').eq('id','news-scan-lock').maybeSingle());
        const checks = { scanLockReady: Boolean(lock), pushConfigured: pushConfigured() };
        const ok = Object.values(checks).every(Boolean);
        return res.status(ok ? 200 : 503).json({ ok, checks });
      }
      // Sources and rules come only from server code, never the request body.
      const result = await scan(sb, { intervalSeconds: 60, runner: 'supabase-cron' });
      if (!result.skipped) {
        // Notifications have already been attempted. Backfill only a bounded
        // number of full translations, retaining the first detection timestamp.
        try { await translate(sb, { limit: 6 }); }
        catch { console.warn('[news-scan] Başlık çevirileri sonraki turda yeniden denenecek.'); }
      }
      const ok = Boolean(result.skipped || result.feeds.length);
      return res.status(ok ? 200 : 503).json({ ok, ...result });
    } catch {
      console.error('[news-scan] Haber taraması tamamlanamadı; SQL kurulumu ve sunucu bağlantısını kontrol edin.');
      return res.status(503).json({ error: 'Haber taraması tamamlanamadı. SQL kurulumu ve sunucu bağlantısını kontrol edin.' });
    }
  };
}

export default createNewsScannerHandler();

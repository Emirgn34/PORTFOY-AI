import { automationDb, checked } from './automationDb.js';
import { deliverNotifications } from './pushNotifications.js';
import { validCronSecret } from './cronAuth.js';
import { requestHedgeJob, reconcileHedgeJob } from './hedgeJobs.js';

export { validCronSecret } from './cronAuth.js';

export function createHedgeRadarHandler({ getDb = automationDb, send = deliverNotifications,
  fetcher = fetch, env = process.env } = {}) {
  return async function hedgeRadarHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const action = req.query?.action ?? 'state';
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({error:'Yöntem desteklenmiyor.'});
    if (action === 'trigger' && (req.method !== 'POST' ||
        !validCronSecret(req.headers['x-cron-secret'], env.CRON_SECRET))) {
      return res.status(401).json({error:'Geçersiz otomasyon kimliği.'});
    }
    let sb;
    try { sb = getDb(); } catch { return res.status(503).json({error:'Radar sunucu bağlantısı kurulmamış.'}); }
    try {
      if (action === 'trigger') {
        // Deployment probe: authenticate the real cron secret and inspect
        // configuration without creating or delivering any notifications.
        if (req.body?.checkOnly === true) {
          const state = checked(await sb.from('hedge_radar_state')
            .select('owner_user_id,updated_at,market_regime').eq('id',1).maybeSingle());
          const checks = {
            stateReady: Boolean(state?.updated_at && state?.market_regime),
            ownerMatches: Boolean(env.HEDGE_RADAR_USER_ID && state?.owner_user_id === env.HEDGE_RADAR_USER_ID),
            pushConfigured: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT),
            manualRefreshConfigured: Boolean(env.HEDGE_GITHUB_TOKEN),
          };
          const ok = Object.values(checks).every(Boolean);
          return res.status(ok ? 200 : 503).json({ok,checks});
        }
        const eventId = checked(await sb.rpc('queue_hedge_radar_notification'));
        const delivery = await send(sb);
        return res.json({ok:true,eventId,...delivery});
      }
      const token = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1];
      if (!token) return res.status(401).json({error:'Oturum gerekli.'});
      const auth = await sb.auth.getUser(token);
      if (auth.error || !auth.data?.user) return res.status(401).json({error:'Geçersiz oturum.'});
      const userId = auth.data.user.id;
      if (!env.HEDGE_RADAR_USER_ID) return res.status(503).json({error:'Kalkan hesabı henüz yapılandırılmadı.'});
      if (userId !== env.HEDGE_RADAR_USER_ID) return res.status(403).json({error:'Bu radar başka hesaba ait.'});
      if (req.method === 'GET' && action === 'state') {
        let state = checked(await sb.from('hedge_radar_state').select('*').eq('id',1).eq('owner_user_id',userId).maybeSingle());
        state = await reconcileHedgeJob(sb,state,{fetcher,env});
        if (state) {
          delete state.pending_notification;
          delete state.last_close_notified_session;
        }
        return res.json({state});
      }
      if (req.method === 'POST' && action === 'refresh') {
        if (!env.HEDGE_GITHUB_TOKEN) return res.status(503).json({error:'Analiz başlatma bağlantısı kurulmamış.'});
        let result;
        try {
          result = await requestHedgeJob(sb,userId,{fetcher,env});
        } catch (error) {
          return res.status(503).json({error:error.message});
        }
        if (result.retryAfterSeconds>0) {
          res.setHeader('Retry-After',String(result.retryAfterSeconds));
          return res.status(429).json({error:`Yeni analiz için ${result.retryAfterSeconds} saniye bekleyin.`,retryAfterSeconds:result.retryAfterSeconds});
        }
        return res.status(202).json({status:result.status,revision:result.revision,
          message:result.dispatch?'Analiz sıraya alındı. Sonuç hazır olduğunda panel yenilenecek.':
            result.status==='running'?'Analiz zaten çalışıyor. Sonuç burada güncellenecek.':'Analiz zaten sırada. Sonuç burada güncellenecek.'});
      }
      return res.status(400).json({error:'Geçersiz radar işlemi.'});
    } catch (error) {
      console.error('[hedge-radar]',error.message);
      return res.status(503).json({error:'Radar verisi alınamadı. SQL kurulumu ve arka plan analizini kontrol edin.'});
    }
  };
}
export default createHedgeRadarHandler();

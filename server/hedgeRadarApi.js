import { timingSafeEqual } from 'node:crypto';
import { automationDb, checked } from './automationDb.js';
import { deliverNotifications } from './pushNotifications.js';

export function validCronSecret(value, expected) {
  if (typeof value !== 'string' || !expected || expected.length < 32) return false;
  const a = Buffer.from(value), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

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
        const state = checked(await sb.from('hedge_radar_state').select('*').eq('id',1).eq('owner_user_id',userId).maybeSingle());
        if (state) {
          delete state.pending_notification;
          delete state.last_close_notified_session;
        }
        return res.json({state});
      }
      if (req.method === 'POST' && action === 'refresh') {
        if (!env.HEDGE_GITHUB_TOKEN) return res.status(503).json({error:'Analiz başlatma bağlantısı kurulmamış.'});
        const repository = env.HEDGE_GITHUB_REPOSITORY || 'Emirgn34/PORTFOY-AI';
        if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Geçersiz depo ayarı.');
        const request = await sb.rpc('request_hedge_radar_refresh',{p_user_id:userId});
        if (request.error?.message?.includes('5 dakika')) return res.status(429).json({error:request.error.message});
        const revision = checked(request);
        try {
          const response = await fetcher(`https://api.github.com/repos/${repository}/actions/workflows/hedge_radar.yml/dispatches`, {
            method:'POST', headers:{Authorization:`Bearer ${env.HEDGE_GITHUB_TOKEN}`,
              Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
            body:JSON.stringify({ref:'main'}),signal:AbortSignal.timeout(10000),
          });
          if (!response.ok) throw new Error('İş akışı başlatılamadı.');
        } catch {
          checked(await sb.from('hedge_radar_state').update({refresh_status:'failed',refresh_error:'Analiz iş akışı başlatılamadı.'})
            .eq('id',1).eq('owner_user_id',userId).eq('refresh_version',revision));
          return res.status(503).json({error:'Analiz başlatılamadı; GitHub Actions bağlantısını kontrol edin.'});
        }
        return res.status(202).json({status:'queued',revision,message:'Analiz sıraya alındı. Sonuç hazır olduğunda panel yenilenecek.'});
      }
      return res.status(400).json({error:'Geçersiz radar işlemi.'});
    } catch (error) {
      console.error('[hedge-radar]',error.message);
      return res.status(503).json({error:'Radar verisi alınamadı. SQL kurulumu ve arka plan analizini kontrol edin.'});
    }
  };
}
export default createHedgeRadarHandler();

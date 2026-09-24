import { automationDb, checked } from './automationDb.js';
import { pushConfigured, validatePushSubscription } from './pushNotifications.js';
import { validatePortfolioPreferences } from '../src/utils/valueSelection.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Yöntem desteklenmiyor.' });
  let sb;
  try { sb = automationDb(); } catch (e) { return res.status(503).json({ error: e.message }); }
  const token = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1];
  if (!token) return res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });
  const userId = data.user.id;
  const action = req.query.action;
  try {
    if (req.method === 'GET' && action === 'value') {
      const [versions, jobs] = await Promise.all([
        sb.from('value_portfolio_versions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(12),
        sb.from('portfolio_jobs').select('id,status,preferences,error,created_at,started_at,completed_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1),
      ]);
      return res.json({ versions: checked(versions), job: checked(jobs)?.[0] ?? null });
    }
    if (req.method === 'POST' && action === 'value') {
      let preferences;
      try { preferences = validatePortfolioPreferences(req.body?.preferences); }
      catch (e) { return res.status(400).json({ error: e.message }); }
      const result = await sb.rpc('request_value_portfolios', { p_user_id: userId, p_preferences: preferences });
      if (result.error?.message?.includes('5 dakika')) return res.status(429).json({ error: result.error.message });
      return res.status(202).json({ id: checked(result), status: 'queued' });
    }
    if (req.method === 'GET' && action === 'sources') {
      return res.json({ run: checked(await sb.from('source_portfolio_runs').select('*').order('created_at', { ascending: false }).limit(1))?.[0] ?? null,
        status: checked(await sb.from('monitor_status').select('*').eq('id', 'sources').maybeSingle()) });
    }
    if (req.method === 'GET' && action === 'catalysts') {
      return res.json({ events: checked(await sb.from('notification_events').select('*').eq('topic','catalyst').order('published_at', { ascending: false }).limit(100)),
        status: checked(await sb.from('monitor_status').select('*').eq('id','news').maybeSingle()) });
    }
    if (req.method === 'GET' && action === 'push') return res.json({ configured: pushConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY ?? null,
      subscriptions:checked(await sb.from('push_subscriptions').select('endpoint,topics').eq('user_id',userId)) });
    if (req.method === 'POST' && action === 'push') {
      if (!pushConfigured()) return res.status(503).json({ error: 'Telefon bildirimleri sunucuda henüz etkinleştirilmemiş.' });
      let subscription;
      try { subscription = validatePushSubscription(req.body?.subscription); }
      catch (e) { return res.status(400).json({ error: e.message }); }
      const topics = req.body?.topics;
      if (!Array.isArray(topics) || !topics.length || topics.some((t) => !['catalyst','source-portfolios'].includes(t))) return res.status(400).json({ error: 'Bildirim konusunu seçin.' });
      const existing = checked(await sb.from('push_subscriptions').select('id,user_id').eq('endpoint', subscription.endpoint).maybeSingle());
      if (existing && existing.user_id !== userId) return res.status(409).json({ error: 'Bu cihazdaki abonelik başka hesaba bağlı; önce o hesapta bildirimleri kapatın.' });
      checked(await sb.from('push_subscriptions').upsert({ user_id: userId, endpoint: subscription.endpoint, subscription, topics, updated_at: new Date().toISOString() }, { onConflict: 'endpoint' }));
      return res.json({ ok: true });
    }
    if (req.method === 'DELETE' && action === 'push') {
      checked(await sb.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', String(req.body?.endpoint ?? '')));
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'Geçersiz işlem.' });
  } catch (e) {
    console.error('[automation]', e.message);
    return res.status(503).json({ error: 'Bu özellik şu an kullanılamıyor. Veri tabloları ve arka plan hizmeti kontrol edilmeli.' });
  }
}

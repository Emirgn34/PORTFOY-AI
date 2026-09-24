import webpush from 'web-push';
import { checked } from './automationDb.js';

export function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}
export function validatePushSubscription(subscription) {
  let url;
  try { url = new URL(subscription?.endpoint); } catch { throw new Error('Bildirim adresi geçersiz.'); }
  // Sunucudan keyfi adreslere istek gönderilmesini engelle.
  const allowed = url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com'
    || url.hostname.endsWith('.notify.windows.com') || url.hostname === 'web.push.apple.com';
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.href.length > 2048) {
    throw new Error('Bu bildirim sağlayıcısı desteklenmiyor.');
  }
  const keys = subscription.keys;
  if (!/^[A-Za-z0-9_-]{87}$/.test(keys?.p256dh ?? '') || !/^[A-Za-z0-9_-]{22}$/.test(keys?.auth ?? '')) {
    throw new Error('Bildirim anahtarları geçersiz.');
  }
  return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}
export async function sendTestNotification(subscription) {
  const validated=validatePushSubscription(subscription);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  await webpush.sendNotification(validated,JSON.stringify({title:'PortföyAI · Bildirim testi',
    body:'Bu bir test bildirimidir. Telefon bildirim bağlantınız çalışıyor.',url:'/news?tab=catalysts',tag:'portfoyai-push-test'}),
    {TTL:60,urgency:'high',timeout:10000});
}
export async function deliverNotifications(sb) {
  if (!pushConfigured()) return { configured: false, sent: 0 };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const events = checked(await sb.from('notification_events').select('*').gt('expires_at', new Date().toISOString()).order('detected_at').limit(100));
  let sent = 0;
  for (let offset = 0; ; offset += 500) {
    const subscriptions = checked(await sb.from('push_subscriptions').select('*').order('id').range(offset, offset + 499));
    for (const subscription of subscriptions) {
      for (const event of events) {
        if (Date.parse(event.expires_at) <= Date.now()) continue;
        if (!subscription.topics.includes(event.topic) || Date.parse(subscription.created_at) > Date.parse(event.detected_at)) continue;
        if (!checked(await sb.rpc('claim_push_delivery', { p_event_id: event.id, p_subscription_id: subscription.id }))) continue;
        try {
          validatePushSubscription(subscription.subscription);
          await webpush.sendNotification(subscription.subscription, JSON.stringify({
            title: event.title.slice(0, 120), body: event.body.slice(0, 250), url: event.url, tag: event.id,
          }), { TTL: Math.max(0, Math.floor((Date.parse(event.expires_at) - Date.now()) / 1000)), urgency: 'high', timeout: 10000 });
          checked(await sb.from('push_deliveries').update({ status: 'sent', delivered_at: new Date().toISOString() }).eq('event_id', event.id).eq('subscription_id', subscription.id));
          sent++;
        } catch (error) {
          if ([404, 410].includes(error.statusCode)) {
            checked(await sb.from('push_subscriptions').delete().eq('id', subscription.id));
            break;
          }
          checked(await sb.from('push_deliveries').update({ status: 'pending' }).eq('event_id', event.id).eq('subscription_id', subscription.id));
        }
      }
    }
    if (subscriptions.length < 500) break;
  }
  return { configured: true, sent };
}

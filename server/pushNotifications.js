import webpush from 'web-push';
import { checked, recordMonitor } from './automationDb.js';
import { mapLimit } from './concurrency.js';

export function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}
export function notificationBody(event) {
  if(event.topic!=='catalyst') return event.body;
  return event.data?.titleTr || `${event.data?.symbols?.join(', ') || 'Şirket'}: ${event.data?.label || 'Yeni şirket gelişmesi'}. Ayrıntılar kaynak haberde.`;
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
// A fixed time boundary and primary-key cursors keep inserts/deletions during
// delivery from shifting pages. Already delivered events must not hide new ones.
async function activeEvents(sb, now) {
  const events = [];
  let cursor;
  for (;;) {
    let query = sb.from('notification_events').select('*').gt('expires_at', now)
      .lte('detected_at', now).order('id').limit(100);
    if (cursor) query = query.gt('id', cursor);
    const page = checked(await query);
    events.push(...page);
    if (page.length < 100) break;
    cursor = page.at(-1).id;
  }
  return events.sort((a, b) => Date.parse(b.detected_at) - Date.parse(a.detected_at) || a.id.localeCompare(b.id));
}

export async function deliverNotifications(sb, { sender = webpush, now = () => new Date() } = {}) {
  if (!pushConfigured()) return { configured: false, sent: 0 };
  sender.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const events = await activeEvents(sb, now().toISOString());
  const result = { configured: true, sent: 0, failed: 0, removed: 0, errors: {} };
  let cursor;
  for (;;) {
    let query = sb.from('push_subscriptions').select('*').order('id').limit(100);
    if (cursor) query = query.gt('id', cursor);
    const subscriptions = checked(await query);
    // Keep an unresponsive endpoint from blocking delivery to every other device.
    await mapLimit(subscriptions, 5, async (subscription) => {
      for (const event of events) {
        if (event.topic === 'hedge-radar' && (!event.data?.userId || event.data.userId !== subscription.user_id)) continue;
        if (Date.parse(event.expires_at) <= now().getTime()) continue;
        if (!subscription.topics.includes(event.topic) || Date.parse(subscription.created_at) > Date.parse(event.detected_at)) continue;
        if (!checked(await sb.rpc('claim_push_delivery', { p_event_id: event.id, p_subscription_id: subscription.id }))) continue;
        let validated;
        try {
          validated = validatePushSubscription(subscription.subscription);
        } catch {
          checked(await sb.from('push_deliveries').update({ status: 'failed' }).eq('event_id', event.id).eq('subscription_id', subscription.id));
          result.failed++;
          result.errors.invalid_subscription = (result.errors.invalid_subscription || 0) + 1;
          continue;
        }
        try {
          await sender.sendNotification(validated, JSON.stringify({
            title: event.title.slice(0, 120), body: notificationBody(event).slice(0, 250), url: event.url, tag: event.id,
          }), { TTL: Math.max(0, Math.floor((Date.parse(event.expires_at) - now().getTime()) / 1000)), urgency: 'high', timeout: 10000 });
        } catch (error) {
          const code = Number(error.statusCode);
          const label = Number.isInteger(code) && code >= 400 && code <= 599 ? `http_${code}` : 'network';
          result.errors[label] = (result.errors[label] || 0) + 1;
          if ([404, 410].includes(code)) {
            checked(await sb.from('push_subscriptions').delete().eq('id', subscription.id));
            result.removed++;
            break;
          }
          const retryable = !code || code === 408 || code === 429 || code >= 500;
          checked(await sb.from('push_deliveries').update({ status: retryable ? 'pending' : 'failed' }).eq('event_id', event.id).eq('subscription_id', subscription.id));
          result.failed++;
          continue;
        }
        // A database failure after provider acceptance must not immediately mark
        // the delivery pending and resend it. Its existing lease will expire.
        checked(await sb.from('push_deliveries').update({ status: 'sent', delivered_at: now().toISOString() }).eq('event_id', event.id).eq('subscription_id', subscription.id));
        result.sent++;
      }
    });
    if (subscriptions.length < 100) break;
    cursor = subscriptions.at(-1).id;
  }
  await recordMonitor(sb, 'push', result);
  if (result.failed || result.removed) console.warn('[push]', JSON.stringify(result));
  return result;
}

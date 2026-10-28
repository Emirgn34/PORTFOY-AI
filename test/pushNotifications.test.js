import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { deliverNotifications } from '../server/pushNotifications.js';

const clock = new Date('2026-10-28T10:00:00Z');
const now = () => new Date(clock);
const envKeys = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];
const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
before(() => { for (const key of envKeys) process.env[key] = 'test-value'; });
after(() => { for (const key of envKeys) {
  if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
} });

const event = (id, overrides = {}) => ({ id, topic: 'catalyst', title: 'Yeni haber', body: 'Özet', url: '/news',
  data: { symbols: ['TEST'], label: 'Sözleşme' }, detected_at: '2026-10-28T09:59:00Z',
  expires_at: '2026-10-28T10:14:00Z', ...overrides });
const device = (id, overrides = {}) => ({ id, user_id: 'owner', topics: ['catalyst', 'hedge-radar'],
  created_at: '2026-10-28T09:00:00Z', subscription: { endpoint: `https://web.push.apple.com/${id}`,
    keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } }, ...overrides });
const sender = (sendNotification = async () => {}) => ({ setVapidDetails() {}, sendNotification });

function memoryDb(events, devices, sent = []) {
  const tables = { notification_events: structuredClone(events), push_subscriptions: structuredClone(devices),
    push_deliveries: sent.map(([event_id, subscription_id]) => ({ event_id, subscription_id, status: 'sent' })), monitor_status: [] };
  const reads = [];
  return { tables, reads, async rpc(name, { p_event_id, p_subscription_id }) {
    assert.equal(name, 'claim_push_delivery');
    let row = tables.push_deliveries.find((r) => r.event_id === p_event_id && r.subscription_id === p_subscription_id);
    if (row && row.status !== 'pending') return { data: false };
    if (!row) { row = { event_id: p_event_id, subscription_id: p_subscription_id }; tables.push_deliveries.push(row); }
    row.status = 'sending';
    return { data: true };
  }, from(table) {
    const filters = [], orders = [];
    let limit = Infinity, update, remove = false;
    const query = { select() { return this; },
      gt(key, value) { filters.push((r) => r[key] > value); return this; },
      lte(key, value) { filters.push((r) => r[key] <= value); return this; },
      eq(key, value) { filters.push((r) => r[key] === value); return this; },
      order(key) { orders.push(key); return this; }, limit(n) { limit = n; return this; },
      update(value) { update = value; return this; }, delete() { remove = true; return this; },
      async upsert(value) { tables[table] = [structuredClone(value)]; return { data: null }; },
      then(resolve, reject) {
        const rows = tables[table].filter((r) => filters.every((filter) => filter(r))).sort((a, b) => {
          for (const key of orders) { if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1; } return 0;
        }).slice(0, limit);
        if (update) rows.forEach((row) => Object.assign(row, update));
        else if (remove) tables[table] = tables[table].filter((row) => !rows.includes(row));
        else reads.push({ table, count: rows.length });
        return Promise.resolve({ data: update || remove ? null : structuredClone(rows) }).then(resolve, reject);
      },
    };
    return query;
  } };
}

test('100 işlenmiş olay yeni haberi gizlemez; sayfalar taranır ve yeni haber önce gönderilir', async () => {
  const older = Array.from({ length: 100 }, (_, i) => event(`a-${String(i).padStart(3, '0')}`));
  const db = memoryDb([...older, event('z-new', { detected_at: '2026-10-28T09:59:59Z' })], [device('one')], older.map((e) => [e.id, 'one']));
  const tags = [];
  const result = await deliverNotifications(db, { now, sender: sender(async (_, payload) => tags.push(JSON.parse(payload).tag)) });
  assert.deepEqual(tags, ['z-new']);
  assert.equal(result.sent, 1);
  assert.deepEqual(db.reads.filter((r) => r.table === 'notification_events').map((r) => r.count), [100, 1]);
  await deliverNotifications(db, { now, sender: sender(async () => assert.fail('Tekrar gönderilmemeli')) });
});

test('yeni olaylar önce gönderilir; eski, ileride algılanan ve abonelik öncesi olaylar gönderilmez', async () => {
  const db = memoryDb([event('a-old'), event('z-new', { detected_at: '2026-10-28T09:59:59Z' }),
    event('expired', { expires_at: '2026-10-28T09:59:00Z' }), event('future', { detected_at: '2026-10-28T10:00:01Z' }),
    event('before-subscription', { detected_at: '2026-10-28T08:00:00Z' })], [device('one')]);
  const tags = [];
  await deliverNotifications(db, { now, sender: sender(async (_, payload, options) => {
    tags.push(JSON.parse(payload).tag); assert.ok(options.TTL > 0); assert.equal(options.urgency, 'high');
  }) });
  assert.deepEqual(tags, ['z-new', 'a-old']);
});

test('silinen abonelik sayfaları kaydırmaz; 101. cihaz da bildirim alır', async () => {
  const devices = Array.from({ length: 101 }, (_, i) => device(String(i).padStart(3, '0')));
  const db = memoryDb([event('news')], devices);
  const recipients = [];
  const result = await deliverNotifications(db, { now, sender: sender(async (sub) => {
    if (sub.endpoint.endsWith('/000')) throw Object.assign(new Error('gone'), { statusCode: 410 });
    recipients.push(sub.endpoint);
  }) });
  assert.equal(result.removed, 1); assert.equal(result.sent, 100);
  assert.ok(recipients.includes('https://web.push.apple.com/100'));
});

test('yavaş bir cihaz diğer cihazı bekletmez; eşzamanlı gönderim beşi aşmaz', async () => {
  const db = memoryDb([event('news')], Array.from({ length: 8 }, (_, i) => device(String(i))));
  let active = 0, maxActive = 0, release;
  const slow = new Promise((resolve) => { release = resolve; });
  const done = [];
  await deliverNotifications(db, { now, sender: sender(async (sub) => {
    active++; maxActive = Math.max(maxActive, active);
    if (sub.endpoint.endsWith('/0')) await slow;
    else { done.push(sub.endpoint); release(); }
    active--;
  }) });
  assert.equal(done.length, 7); assert.ok(maxActive > 1 && maxActive <= 5);
});

test('geçici hata yeniden denenebilir kalır; kalıcı hata ayrılır, hassas hata metni kaydedilmez', async () => {
  const db = memoryDb([event('news')], [device('bad-key', { subscription: {} }), device('network'), device('forbidden'), device('ok')]);
  const result = await deliverNotifications(db, { now, sender: sender(async (sub) => {
    if (sub.endpoint.endsWith('/network')) throw new Error('secret endpoint or key');
    if (sub.endpoint.endsWith('/forbidden')) throw Object.assign(new Error('secret'), { statusCode: 403 });
  }) });
  assert.equal(result.sent, 1); assert.equal(result.failed, 3);
  assert.deepEqual(result.errors, { invalid_subscription: 1, network: 1, http_403: 1 });
  const status = Object.fromEntries(db.tables.push_deliveries.map((d) => [d.subscription_id, d.status]));
  assert.deepEqual(status, { 'bad-key': 'failed', network: 'pending', forbidden: 'failed', ok: 'sent' });
  assert.equal(JSON.stringify(db.tables.monitor_status).includes('secret'), false);
});

test('konu tercihi ve kalkan hesabı izolasyonu korunur', async () => {
  const db = memoryDb([event('private', { topic: 'hedge-radar', data: { userId: 'owner' } }),
    event('missing-owner', { topic: 'hedge-radar', data: {} })], [device('owner'), device('other', { user_id: 'other' }),
    device('opt-out', { topics: ['catalyst'] })]);
  const recipients = [];
  await deliverNotifications(db, { now, sender: sender(async (sub) => recipients.push(sub.endpoint)) });
  assert.deepEqual(recipients, ['https://web.push.apple.com/owner']);
});

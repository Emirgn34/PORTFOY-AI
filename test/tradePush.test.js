import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { deliverNotifications } from '../server/pushNotifications.js';

test('trade push targets only opted-in owner devices, rechecks permission, uses a short TTL and isolates other topics', async () => {
  const clock = new Date('2026-11-11T15:30:00Z');
  const keys = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) process.env[key] = 'test-value';
  const events = [{ id: 'trade-signal', topic: 'trade', title: 'TEST · Trade', body: 'Setup', url: '/trade?symbol=TEST',
    data: { userId: 'owner' }, detected_at: clock.toISOString(), expires_at: new Date(clock.getTime() + 12_000).toISOString() },
    { id: 'other-news', topic: 'catalyst', title: 'News', body: 'News', url: '/news', data: {},
      detected_at: clock.toISOString(), expires_at: new Date(clock.getTime() + 60_000).toISOString() }];
  const devices = [
    { id: 'owner-on', user_id: 'owner', topics: ['trade'] },
    { id: 'owner-off', user_id: 'owner', topics: ['catalyst'] },
    { id: 'other-on', user_id: 'other', topics: ['trade'] },
    { id: 'revoked', user_id: 'owner', topics: ['trade'] },
  ].map((device) => ({ ...device, created_at: '2026-11-11T14:00:00Z', subscription: {
    endpoint: `https://web.push.apple.com/${device.id}`, keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
  } }));
  const sends = [], claims = [], checks = [];
  let permit = true, expireAfterClaim = false;
  const db = { async rpc(name, args) {
    if (name === 'trade_delivery_allowed') { checks.push(args); return { data: permit }; }
    assert.equal(name, 'claim_push_delivery'); claims.push(args);
    if (expireAfterClaim) clock.setTime(clock.getTime() + 13_000);
    return { data: true };
  }, from(table) {
    const filters = [];
    let write = false;
    return { select() { return this; }, gt(key, value) { filters.push((row) => row[key] > value); return this; },
      lte(key, value) { filters.push((row) => row[key] <= value); return this; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return this; },
      eq(key, value) { filters.push((row) => row[key] === value); return this; },
      order() { return this; }, limit() { return this; }, update() { write = true; return this; }, upsert() { write = true; return this; },
      then(resolve, reject) {
        // Simulate opting out before a second delivery pass.
        const rows = table === 'notification_events' ? events : table === 'push_subscriptions' ? devices : [];
        return Promise.resolve({ data: write ? null : rows.filter((row) => filters.every((filter) => filter(row))) }).then(resolve, reject);
      },
    };
  } };
  const sender = { setVapidDetails() {}, async sendNotification(device, payload, options) {
    assert.ok(options.TTL > 0 && options.TTL <= 15); assert.equal(options.urgency, 'high');
    assert.equal(options.timeout, 3000);
    const parsed = JSON.parse(payload); assert.equal(parsed.topic, 'trade'); assert.equal(parsed.expiresAt, events[0].expires_at);
    sends.push(device.endpoint);
  } };
  try {
    const result = await deliverNotifications(db, { sender, now: () => clock, topics: ['trade'] });
    assert.equal(result.sent, 2);
    assert.deepEqual(sends.sort(), ['https://web.push.apple.com/owner-on', 'https://web.push.apple.com/revoked']);
    assert.equal(checks.length, 2); assert.equal(claims.length, 2);
    sends.length = 0; permit = false;
    await deliverNotifications(db, { sender, now: () => clock, topics: ['trade'] });
    assert.deepEqual(sends, []);
    permit = true; expireAfterClaim = true;
    await deliverNotifications(db, { sender, now: () => clock, topics: ['trade'] });
    assert.deepEqual(sends, [], 'time spent claiming the outbox cannot send an expired trade');
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});

test('a late trade push displays expiry instead of a stale trading reason; fresh trades and news retain their content', async () => {
  const handlers = {}, displayed = [];
  const self = { addEventListener(type, handler) { handlers[type] = handler; },
    registration: { async showNotification(title, options) { displayed.push({ title, ...options }); } } };
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { self, Date, URL });
  async function push(data) {
    let work;
    handlers.push({ data: { json: () => data }, waitUntil(promise) { work = promise; } });
    await work; return displayed.at(-1);
  }
  const expired = await push({ title: 'TEST Trade', body: 'Old entry reason', topic: 'trade', expiresAt: new Date(Date.now() - 1000).toISOString(), url: '/trade?symbol=TEST' });
  assert.match(expired.body, /geçerliliği sona erdi/); assert.ok(!expired.body.includes('Old entry'));
  assert.equal(expired.data.url, '/trade?symbol=TEST');
  assert.equal((await push({ body: 'Fresh reason', topic: 'trade', expiresAt: new Date(Date.now() + 10_000).toISOString() })).body, 'Fresh reason');
  assert.equal((await push({ body: 'Company news', topic: 'catalyst' })).body, 'Company news');
});

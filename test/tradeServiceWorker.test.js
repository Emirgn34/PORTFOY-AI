import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
async function notification(payload) {
  const listeners = {}, shown = [];
  runInNewContext(source, { Date, URL, self: {
    addEventListener: (name, listener) => { listeners[name] = listener; },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); } },
  } });
  let pending;
  listeners.push({ data: { json: () => payload }, waitUntil: (promise) => { pending = promise; } });
  await pending;
  return shown[0];
}

test('geç gelen trade bildirimi eski hedef yerine görünür süre doldu mesajı gösterir', async () => {
  const result = await notification({ topic: 'trade', title: 'AAPL', body: '%3 hedef', expiresAt: new Date(Date.now() - 1000).toISOString(), url: '/trade?symbol=AAPL' });
  assert.match(result.options.body, /geçerliliği sona erdi/);
  assert.equal(result.options.body.includes('%3'), false);
  assert.equal(result.options.data.url, '/trade?symbol=AAPL');
});

test('geçerliliği doğrulanamayan trade bildirimi de eski hedef göstermez', async () => {
  const result = await notification({ topic: 'trade', body: '%5 hedef' });
  assert.match(result.options.body, /geçerliliği sona erdi/);
});

test('güncel trade ve diğer bildirimlerin gövdesi korunur', async () => {
  assert.equal((await notification({ topic: 'trade', body: 'Güncel sinyal', expiresAt: new Date(Date.now() + 10000).toISOString() })).options.body, 'Güncel sinyal');
  assert.equal((await notification({ topic: 'catalyst', body: 'Yeni şirket haberi' })).options.body, 'Yeni şirket haberi');
});

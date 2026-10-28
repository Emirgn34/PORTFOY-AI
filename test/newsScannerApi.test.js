import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsScannerHandler } from '../server/newsScannerApi.js';

const secret = 'a'.repeat(40);
const response = () => ({ code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const request = (overrides = {}) => ({ method: 'POST', headers: { 'x-cron-secret': secret }, body: {}, ...overrides });

test('haber taraması anonim kullanıcı veya JWT ile tetiklenemez; secret kontrolü veritabanından önce yapılır', async () => {
  const handler = createNewsScannerHandler({ env: { CRON_SECRET: secret }, getDb: () => assert.fail('Veri okunmamalı') });
  for (const headers of [{}, { authorization: 'Bearer signed-user' }, { 'x-cron-secret': 'wrong' }]) {
    const res = response(); await handler(request({ headers }), res); assert.equal(res.code, 401);
  }
  const res = response(); await handler(request({ method: 'GET' }), res); assert.equal(res.code, 405);
});

test('haber anahtarı tanımlandığında yalnız o kabul edilir; kalkanın eski anahtarı haberleri açamaz', async () => {
  const newsSecret = 'b'.repeat(64);
  let scans = 0;
  const handler = createNewsScannerHandler({ env: { CRON_SECRET: secret, NEWS_CRON_SECRET: newsSecret },
    getDb: () => ({}), scan: async () => { scans++; return { skipped: true, feeds: [] }; } });
  const old = response(); await handler(request(), old);
  assert.equal(old.code, 401); assert.equal(scans, 0);
  const fresh = response(); await handler(request({ headers: { 'x-cron-secret': newsSecret } }), fresh);
  assert.equal(fresh.code, 200); assert.equal(scans, 1);
  assert.ok(!JSON.stringify(fresh.body).includes(newsSecret));
});

test('haber anahtarı boş veya kısaysa eski anahtara dönülmez; kurulum hatası kapalı kalır', async () => {
  for (const newsSecret of ['', 'short']) {
    const handler = createNewsScannerHandler({ env: { CRON_SECRET: secret, NEWS_CRON_SECRET: newsSecret },
      getDb: () => assert.fail('Geçersiz yapılandırma veri okuyamaz') });
    const res = response(); await handler(request(), res);
    assert.equal(res.code, 401);
  }
});

test('geçerli secret ile sabit kaynaklar ve 60 saniyelik mod kullanılır; çeviri taramadan sonra sınırlı çalışır', async () => {
  const calls = [], sb = {};
  const handler = createNewsScannerHandler({ env: { CRON_SECRET: secret }, getDb: () => sb,
    scan: async (db, options) => { assert.equal(db, sb); assert.deepEqual(options, { intervalSeconds: 60, runner: 'supabase-cron' }); calls.push('scan'); return { feeds: ['feed'] }; },
    translate: async (_, options) => { calls.push('translate'); assert.deepEqual(options, { limit: 6 }); },
  });
  const res = response();
  await handler(request({ body: { url: 'http://127.0.0.1', intervalSeconds: 1 } }), res);
  assert.equal(res.code, 200); assert.deepEqual(calls, ['scan', 'translate']);
  assert.ok(!JSON.stringify(res.body).includes(secret));
});

test('kurulum kontrolü haber kaydetmez veya bildirim göndermez; SQL yoksa açıkça başarısız olur', async () => {
  let ready = true;
  const sb = { from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: ready ? { id: 'news-scan-lock' } : null }; } }; } };
  const handler = createNewsScannerHandler({ env: { CRON_SECRET: secret }, getDb: () => sb,
    scan: async () => assert.fail('Tarama yapılmamalı'), translate: async () => assert.fail('Çeviri yapılmamalı') });
  const res = response(); await handler(request({ body: { checkOnly: true } }), res);
  assert.equal(res.body.checks.scanLockReady, true);
  ready = false;
  const missing = response(); await handler(request({ body: { checkOnly: true } }), missing);
  assert.equal(missing.code, 503); assert.equal(missing.body.checks.scanLockReady, false);
});

test('tüm kaynaklar başarısızsa 503, başka tarama etkinse 200 döner ve çeviri başlamaz', async () => {
  for (const skipped of [false, true]) {
    const handler = createNewsScannerHandler({ env: { CRON_SECRET: secret }, getDb: () => ({}),
      scan: async () => ({ skipped, feeds: [] }), translate: async () => { assert.equal(skipped, false); } });
    const res = response(); await handler(request(), res); assert.equal(res.code, skipped ? 200 : 503);
  }
});

test('otomatik hedge hatası başarılı haber taramasını bozmaz; kurulum kontrolü hedge başlatmaz', async () => {
  let attempts=0;
  const handler=createNewsScannerHandler({env:{CRON_SECRET:secret},getDb:()=>({}),
    scan:async()=>({feeds:['source']}),translate:async()=>{},
    refreshHedge:async()=>{attempts++;throw new Error('GitHub unavailable');}});
  const res=response();await handler(request(),res);
  assert.equal(res.code,200);assert.equal(res.body.ok,true);assert.equal(attempts,1);
  const probe=createNewsScannerHandler({env:{CRON_SECRET:secret},getDb:()=>({from(){return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:{id:'news-scan-lock'}};}};}}),
    refreshHedge:async()=>assert.fail('Kurulum kontrolü analiz tetiklememeli')});
  await probe(request({body:{checkOnly:true}}),response());
});

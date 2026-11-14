import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsHandler, normalizeNewsArticle } from '../server/newsApi.js';

const now = new Date('2026-11-14T12:00:00Z');
const article = { id: 'a', symbol: 'AAPL', title: 'Company raises guidance', publisher: 'Reuters', publishedAt: now.toISOString(), link: 'https://example.com/a' };
const response = () => ({ code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const request = (query = {}, headers = { authorization: 'Bearer token' }) => ({ method: 'GET', query, headers });

test('haber normalleştirme bozuk bağlantı ve gelecekteki kaydı engeller; eksik tarihi uydurmaz', () => {
  assert.equal(normalizeNewsArticle({ ...article, publishedAt: '2026-11-15' }, now), null);
  assert.equal(normalizeNewsArticle({ ...article, title: '' }, now), null);
  for (const link of ['javascript:alert(1)', 'data:text/html,test', 'https://user:password@example.com']) {
    const row = normalizeNewsArticle({ ...article, link, publishedAt: null }, now);
    assert.equal(row.link, null); assert.equal(row.publishedAt, null);
  }
});
function database({ rows = [], error = null, authenticated = true } = {}) {
  return { auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'user' } : null } }) }, from(table) {
    assert.equal(table, 'news');
    return { select() { return this; }, order() { return this; }, limit() { return this; }, in() { return this; }, then(resolve, reject) { return Promise.resolve({ data: rows, error }).then(resolve, reject); } };
  } };
}

test('haber API kimlik olmadan kaynak veya veri çağırmaz ve salt okunur çalışır', async () => {
  const handler = createNewsHandler({ getDb: () => assert.fail('Veri açılmamalı') });
  const noToken = response(); await handler(request({}, {}), noToken); assert.equal(noToken.code, 401);
  const mutation = response(); await handler({ ...request(), method: 'POST' }, mutation); assert.equal(mutation.code, 405);
});

test('normal haber tablosu boş veya eksikse doğrudan sembol haberleri gelir', async () => {
  for (const error of [null, { message: 'table missing' }]) {
    const calls = [];
    const handler = createNewsHandler({ getDb: () => database({ error }), loadNews: async (symbol) => { calls.push(symbol); return [{ ...article, symbol }]; }, now: () => now });
    const res = response(); await handler(request({ symbols: 'AAPL' }), res);
    assert.equal(res.code, 200); assert.deepEqual(calls, ['AAPL']);
    assert.equal(res.body.articles[0].sentiment, 'positive');
    assert.equal(res.body.articles[0].reliability, 9);
  }
});

test('yeni arşiv mevcutken normal feed tekrar dış haber sorgulamaz', async () => {
  const handler = createNewsHandler({ getDb: () => database({ rows: [{ id: 'a', symbol: 'AAPL', title: article.title, published_at: now.toISOString(), publisher: 'Reuters' }] }),
    loadNews: async () => assert.fail('Taze arşiv için tekrar sorgu yok'), now: () => now });
  const res = response(); await handler(request(), res);
  assert.equal(res.code, 200); assert.equal(res.body.articles.length, 1);
});

test('bir sembolün taze arşivi aynı gruptaki eksik sembolün haberlerini engellemez', async () => {
  const calls = [];
  const handler = createNewsHandler({ getDb: () => database({ rows: [{ id: 'a', symbol: 'AAPL', title: article.title, published_at: now.toISOString(), publisher: 'Reuters' }] }),
    loadNews: async (symbol) => { calls.push(symbol); return [{ ...article, id: 'm', symbol, title: 'Microsoft company news' }]; }, now: () => now });
  const res = response(); await handler(request({ symbols: 'AAPL,MSFT' }), res);
  assert.equal(res.code, 200); assert.deepEqual(calls, ['MSFT']);
  assert.deepEqual(new Set(res.body.articles.map((a) => a.symbol)), new Set(['AAPL', 'MSFT']));
});

test('sektör sorgusu hisse fiyatı sorgulamaz; kaynağa kullanıcı URLsi göndermez', async () => {
  const handler = createNewsHandler({ getDb: () => database(), searchNews: async (query) => { assert.equal(query, 'banking'); return [article]; },
    loadChart: async () => assert.fail('Sektöre fiyat atanamaz'), now: () => now });
  const res = response(); await handler(request({ action: 'implications', q: 'banking', url: 'http://localhost' }), res);
  assert.equal(res.code, 200); assert.equal(res.body.analysis.priceContext.available, false);
  assert.equal(res.body.analysis.evidence.length, 1);
});

test('fiyat servisi hatası haber özetini düşürmez ve rakam uydurmaz', async () => {
  const handler = createNewsHandler({ getDb: () => database(), loadNews: async () => [article], loadChart: async () => { throw new Error('quote failure'); }, now: () => now });
  const res = response(); await handler(request({ action: 'implications', symbol: 'AAPL' }), res);
  assert.equal(res.code, 200); assert.equal(res.body.analysis.evidence.length, 1);
  assert.equal(res.body.analysis.priceContext.available, false);
  assert.equal(res.body.warnings.length, 1);
});

test('bozuk sembol dış kaynak sorgusuna gitmez ve anonim oturum reddedilir', async () => {
  const handler = createNewsHandler({ getDb: () => database(), loadNews: async () => assert.fail('Sembol dış kaynağa gidemez') });
  const bad = response(); await handler(request({ symbol: 'https://localhost' }), bad); assert.equal(bad.code, 400);
  const anonymous = createNewsHandler({ getDb: () => database({ authenticated: false }) });
  const denied = response(); await anonymous(request(), denied); assert.equal(denied.code, 401);
});

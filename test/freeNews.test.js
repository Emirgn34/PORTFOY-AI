import test from 'node:test';
import assert from 'node:assert/strict';
import { scanFreeNews, FREE_NEWS_FEEDS } from '../server/freeNews.js';

const clock = new Date('2026-10-28T12:00:00Z');
const now = () => new Date(clock);
const feedCount = FREE_NEWS_FEEDS.length;
const xml = '<rss><channel><item><guid>release</guid><title>Example wins major contract</title>' +
  '<link>https://example.com/release</link><pubDate>Wed, 28 Oct 2026 11:59:00 GMT</pubDate>' +
  '<description>Example (NASDAQ: TEST)</description></item></channel></rss>';

function memoryDb(previous = null, claimed = 'scan-token') {
  const state = { news: previous, released: [], claims: 0 };
  return { state, async rpc(name, args) {
    if (name === 'claim_news_scan') { state.claims++; return { data: claimed }; }
    assert.equal(name, 'release_news_scan'); state.released.push(args.p_token); return { data: null };
  }, from(table) {
    assert.equal(table, 'monitor_status');
    return { select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: state.news }; },
      async upsert(row) { state.news = row; return { data: null }; },
    };
  } };
}
const fetchOk = async () => new Response(xml, { headers: { etag: 'version-1', 'last-modified': clock.toUTCString() } });

test('kaynaklar paralel okunur; hızlı kaynak bildirimi yavaş kaynağı beklemez', { timeout: 2000 }, async () => {
  const db = memoryDb();
  let releaseSlow, started = 0, sends = 0, writes = 0;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  const result = await scanFreeNews(db, { now, intervalSeconds: 60,
    fetchImpl: async (url, options) => {
      started++;
      assert.ok(options.signal instanceof AbortSignal);
      if (url === FREE_NEWS_FEEDS[0].url) await slow;
      return fetchOk();
    },
    ingest: async (_, articles) => {
      assert.equal(articles[0].symbols[0], 'TEST'); writes++;
      return { matches: 1, inserted: 1 };
    },
    send: async () => {
      sends++;
      assert.ok(started >= 4);
      assert.ok(writes > 0);
      if (sends === 1) { assert.ok(writes < 4); releaseSlow(); }
    },
  });
  assert.equal(result.feeds.length, feedCount); assert.equal(result.inserted, feedCount);
  assert.ok(sends > 0 && sends <= feedCount + 1);
  assert.deepEqual(db.state.released, ['scan-token']);
  assert.equal(result.lastSuccessfulCheckAt, clock.toISOString());
});

test('304 yalnız başarılı kayıttan sonra kullanılır; değişmeyen kaynak tekrar ayrıştırılmaz', async () => {
  const db = memoryDb();
  let ingestions = 0, sends = 0;
  const ingest = async () => { ingestions++; return { matches: 1, inserted: 1 }; };
  await scanFreeNews(db, { now, fetchImpl: fetchOk, ingest, send: async () => { sends++; } });
  const result = await scanFreeNews(db, { now, ingest, send: async () => { sends++; },
    fetchImpl: async (_, options) => {
      assert.equal(options.headers['If-None-Match'], 'version-1');
      assert.equal(options.headers['If-Modified-Since'], clock.toUTCString());
      return new Response(null, { status: 304 });
    },
  });
  assert.equal(ingestions, feedCount); assert.equal(result.feeds.length, feedCount);
  assert.ok(result.feedChecks.every((feed) => feed.notModified));
  assert.equal(result.inserted, 0); assert.ok(sends >= 2); // retries also run on unchanged feeds
});

test('bozuk XML veya kayıt hatası yeni cache doğrulayıcısını ilerletmez', async () => {
  const db = memoryDb();
  const result = await scanFreeNews(db, { now, fetchImpl: async (url) => url === FREE_NEWS_FEEDS[0].url
    ? new Response('<html>unavailable</html>', { headers: { etag: 'bad' } }) : fetchOk(),
    ingest: async () => { throw new Error('Database unavailable'); }, send: async () => {},
  });
  assert.equal(result.connected, false);
  assert.ok(result.feedChecks.every((feed) => !feed.cacheReady));
  const next = await scanFreeNews(db, { now, send: async () => {},
    fetchImpl: async (_, options) => {
      assert.equal(options.headers['If-None-Match'], undefined);
      return new Response(null, { status: 304 });
    },
  });
  assert.equal(next.connected, false);
  assert.equal(next.errors.length, feedCount);
});

test('tek kaynağın arızası diğer kaynakları durdurmaz; başarısız tur son başarı zamanını yenilemez', async () => {
  const db = memoryDb();
  const first = await scanFreeNews(db, { now, fetchImpl: async (url) => url === FREE_NEWS_FEEDS[0].url
    ? new Response('', { status: 503 }) : fetchOk(),
    ingest: async () => ({ matches: 0, inserted: 0 }), send: async () => {},
  });
  assert.equal(first.feeds.length, feedCount - 1); assert.equal(first.errors.length, 1);
  const later = new Date(clock.getTime() + 60000);
  const failed = await scanFreeNews(db, { now: () => later, fetchImpl: async () => { throw new Error('offline'); }, send: async () => {} });
  assert.equal(failed.connected, false);
  assert.equal(failed.lastSuccessfulCheckAt, first.lastSuccessfulCheckAt);
});

test('ortak kilit alınamazsa ağ veya bildirim isteği yapılmaz', async () => {
  const db = memoryDb(null, null);
  const result = await scanFreeNews(db, { fetchImpl: async () => assert.fail('Kaynak çağrılmamalı'),
    send: async () => assert.fail('Bildirim çağrılmamalı') });
  assert.equal(result.skipped, true); assert.deepEqual(db.state.released, []);
});

test('bildirim hatası kaynakları başarısız göstermez; takip eden tur yeniden gönderebilir', async () => {
  const db = memoryDb();
  const result = await scanFreeNews(db, { now, fetchImpl: fetchOk,
    ingest: async () => ({ matches: 0, inserted: 0 }), send: async () => { throw new Error('push unavailable'); },
  });
  assert.equal(result.connected, true); assert.ok(result.deliveryErrors.length);
  assert.deepEqual(db.state.released, ['scan-token']);
});

test('durum okuması başarısız olsa da kilit bırakılır', async () => {
  const db = memoryDb();
  db.from = () => { throw new Error('database'); };
  await assert.rejects(scanFreeNews(db), /database/);
  assert.deepEqual(db.state.released, ['scan-token']);
});

test('beş resmi kaynak en fazla dört eşzamanlı istekle okunur ve uygulama kimliği gönderilir', async () => {
  const db = memoryDb();
  let active = 0, maximum = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  assert.equal(feedCount, 5);
  const result = await scanFreeNews(db, { now, fetchImpl: async (_, options) => {
    assert.equal(options.headers['User-Agent'], 'PortfoyAI/1.0 (RSS reader)');
    active++; maximum = Math.max(maximum, active);
    if (active === 4) release();
    await gate; active--;
    return fetchOk();
  }, ingest: async () => ({ matches: 0, inserted: 0 }), send: async () => {} });
  assert.equal(maximum, 4); assert.equal(result.feeds.length, 5);
  assert.ok(result.feedChecks.every((feed) => feed.httpStatus === 200));
  const globe = FREE_NEWS_FEEDS.filter((feed) => feed.provider === 'GlobeNewswire');
  assert.ok(globe.every((feed) => new URL(feed.url).hostname === 'rss.globenewswire.com'));
  assert.ok(globe.some((feed) => feed.url.includes('subjectcode/13-')));
  assert.ok(globe.some((feed) => feed.url.includes('subjectcode/7-')));
});

test('GlobeNewswire 403 tanısı akış adıyla saklanır ve diğer kaynaklar sürer', async () => {
  const db = memoryDb();
  const result = await scanFreeNews(db, { now, fetchImpl: async (url) =>
    url.includes('subjectcode/7-') ? new Response('', { status: 403 }) : fetchOk(),
    ingest: async () => ({ matches: 0, inserted: 0 }), send: async () => {} });
  assert.equal(result.feeds.length, 4);
  assert.deepEqual(result.errors, ['GlobeNewswire · Sözleşme: HTTP 403']);
  assert.equal(result.feedChecks.find((feed) => !feed.ok).httpStatus, 403);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { scanCloudPatterns } from '../server/patternCloud.js';
import { createNewsScannerHandler } from '../server/newsScannerApi.js';

function bars(closes, start = '2024-01-01') {
  const base = Date.parse(start);
  return closes.map((close, i) => ({ date: new Date(base + i * 86_400_000).toISOString(), close }));
}
function qualifyingChart() {
  const closes = Array(55).fill(100);
  for (let cycle = 0; cycle < 6; cycle++) closes.push(...Array(10).fill(100), 72, 73.5, 75, 76.5, 78, 79.2, ...Array(5).fill(100));
  closes.push(74); // taze düşüş: kova 25
  return { quotes: bars(closes).map((bar) => ({ date: bar.date, close: bar.close })) };
}

/** Zincirli supabase-js taklidi: select/eq/order/limit/in/upsert. */
function fakeDb(tables, upserts) {
  return { from(table) {
    const chain = {
      select() { return chain; }, eq() { return chain; }, order() { return chain; },
      in(_column, list) { chain._in = list; return chain; },
      limit() { return Promise.resolve({ data: tables[table] ?? [], error: null }); },
      upsert(rows, options) { upserts.push({ table, rows, options }); return Promise.resolve({ data: null, error: null }); },
      then(resolve, reject) {
        const rows = (tables[table] ?? []).filter((row) => !chain._in || chain._in.includes(row.symbol));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return chain;
  } };
}

test('bulut desen turu: bayat ABD sembolü taranır, bağlam birleştirilir, bildirim hedefli teslim edilir', async () => {
  const now = Date.parse('2026-01-02T12:00:00Z');
  const upserts = [];
  const sb = fakeDb({
    tracked_symbol_queue: [{ symbol: 'FRESH1' }, { symbol: 'IONQ' }, { symbol: 'THYAO.IS' }],
    candidates: [],
    trade_context: [
      // IONQ 1 saat önce tarandı → bu turda atlanır
      { symbol: 'IONQ', data: { patternStats: { updatedAt: new Date(now - 3600_000).toISOString() } } },
      // FRESH1'in deseni hiç yok ama mevcut bağlam alanları korunMALI
      { symbol: 'FRESH1', data: { macroEvents: ['korunan-alan'], intelligence: { name: 'Fresh One Inc' } } },
    ],
  }, upserts);
  const chartCalls = [];
  const delivered = [];
  const yahoo = { async chart(symbol) { chartCalls.push(symbol); return qualifyingChart(); } };
  const result = await scanCloudPatterns(sb, { yahoo, now, deliver: async (_db, options) => { delivered.push(options); } });

  assert.deepEqual(chartCalls, ['FRESH1']); // BIST hiç istenmez, taze IONQ atlanır
  assert.equal(result.scanned, 1);
  assert.equal(result.alerts, 1);
  const context = upserts.find((entry) => entry.table === 'trade_context');
  assert.deepEqual(context.rows[0].data.macroEvents, ['korunan-alan']); // birleştirme, ezme değil
  assert.equal(context.rows[0].data.patternStats.state.bucket, 25);
  const events = upserts.find((entry) => entry.table === 'notification_events');
  assert.equal(events.rows[0].topic, 'pattern');
  assert.equal(events.options.ignoreDuplicates, true);
  assert.match(events.rows[0].data.name, /Fresh One/);
  assert.deepEqual(delivered, [{ topics: ['pattern'] }]);
});

test('bulut desen turu: tur başına sınır en bayattan başlar; herkes tazeyken chart hiç çağrılmaz', async () => {
  const now = Date.parse('2026-01-02T12:00:00Z');
  const stale = (hoursAgo) => ({ patternStats: { updatedAt: new Date(now - hoursAgo * 3600_000).toISOString() } });
  const upserts = [];
  const sb = fakeDb({
    tracked_symbol_queue: [{ symbol: 'A' }, { symbol: 'B' }, { symbol: 'C' }],
    candidates: [],
    trade_context: [
      { symbol: 'A', data: stale(7) }, { symbol: 'B', data: stale(30) }, { symbol: 'C', data: stale(10) },
    ],
  }, upserts);
  const chartCalls = [];
  const yahoo = { async chart(symbol) { chartCalls.push(symbol); return { quotes: [] }; } };
  await scanCloudPatterns(sb, { yahoo, now, limit: 2, deliver: async () => assert.fail('Bildirim yok') });
  assert.deepEqual(chartCalls, ['B', 'C']); // en bayat iki sembol

  const freshDb = fakeDb({
    tracked_symbol_queue: [{ symbol: 'A' }], candidates: [],
    trade_context: [{ symbol: 'A', data: stale(1) }],
  }, []);
  const quiet = [];
  await scanCloudPatterns(freshDb, { yahoo: { async chart(symbol) { quiet.push(symbol); return { quotes: [] }; } }, now });
  assert.deepEqual(quiet, []); // 6 saatlik tazelikte iş yok
});

test('haber turu: desen taraması çeviriden sonra koşar ve hatası haber sonucunu bozmaz', async () => {
  const secret = 'a'.repeat(40);
  const calls = [];
  const handler = createNewsScannerHandler({ env: { CRON_SECRET: secret }, getDb: () => ({}),
    scan: async () => { calls.push('scan'); return { feeds: ['feed'] }; },
    translate: async () => { calls.push('translate'); },
    refreshHedge: async () => {},
    scanPatterns: async () => { calls.push('patterns'); throw new Error('Yahoo erişilemedi'); } });
  const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: 'POST', headers: { 'x-cron-secret': secret }, body: {} }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(calls, ['scan', 'translate', 'patterns']);
});

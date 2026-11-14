import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeCurrentDip, buildDipAlertEvent, collectDipPatterns, computeDipStats, summarizeDipPattern,
} from '../server/patternStats.js';
import { refreshTradeContext } from '../server/tradeWorker.js';

/** Deterministik günlük bar üreticisi: closes dizisini ardışık tarihlere döşer. */
function bars(closes, start = '2024-01-01') {
  const base = Date.parse(start);
  return closes.map((close, i) => ({ date: new Date(base + i * 86_400_000).toISOString().slice(0, 10), close }));
}

/**
 * Sentetik seri: 55 gün 100 (ısınma), ardından 6 kez tekrar eden döngü:
 * 10 gün 100 → 1 gün 72 (zirveden %28 düşüş) → 5 gün toparlanma (+%10) →
 * 5 gün yeniden 100. Her düşüş %15/20/25 eşiklerini AYNI gün keser; 5 işlem
 * günü ilerisi +%10'dur — istatistik tam bilinen değerlerle doğrulanır.
 */
function syntheticCloses() {
  const closes = Array(55).fill(100);
  for (let cycle = 0; cycle < 6; cycle++) {
    closes.push(...Array(10).fill(100), 72, 73.5, 75, 76.5, 78, 79.2, ...Array(5).fill(100));
  }
  return closes;
}

test('tekrarlayan düşüş istatistiği: olay sayısı ve ileri getiriler bilinen değerlerle eşleşir', () => {
  const series = bars(syntheticCloses());
  const stats = computeDipStats(series, 25);
  assert.ok(stats, 'yeterli örnek olmalı');
  assert.equal(stats.events, 6);
  const h5 = stats.horizons.h5;
  assert.ok(h5.count >= 3);
  assert.equal(h5.medianPct, 10); // 72 → 79.2 = +%10
  assert.equal(h5.positiveCount, h5.count); // hepsi pozitif kurgulandı
  assert.ok(h5.worstPct > 0);
});

test('yetersiz geçmiş örnek null döner; kısa seri de null döner', () => {
  assert.equal(computeDipStats(bars(Array(30).fill(100)), 15), null);
  // Hiç 40'ı görmeyen seride %40 eşiği için olay yoktur
  assert.equal(computeDipStats(bars(syntheticCloses()), 40), null);
});

test('güncel düşüş durumu: kova, giriş günü ve tazelik doğru hesaplanır', () => {
  const closes = [...syntheticCloses(), 74]; // taze düşüş: zirveden %26 → kova 25
  const series = bars(closes);
  const state = analyzeCurrentDip(series);
  assert.equal(state.bucket, 25);
  assert.equal(state.daysSinceCross, 0);
  assert.equal(state.crossedAt, series.at(-1).date);
  assert.equal(state.lastClose, 74);
  // Düşüş yokken kova 0 ve bölüm bilgisi yok
  const flat = analyzeCurrentDip(bars(Array(80).fill(100)));
  assert.equal(flat.bucket, 0);
  assert.equal(flat.crossedAt, null);
});

test('bildirim olayı: bölüm başına sabit kimlik, eski düşüşe ve zayıf istatistiğe bildirim yok', () => {
  const series = bars([...syntheticCloses(), 74]);
  const summary = summarizeDipPattern(series, { now: new Date('2026-01-02T12:00:00Z') });
  const event = buildDipAlertEvent({ symbol: 'IONQ', name: 'IonQ', stats: summary.stats, state: summary.state, now: new Date('2026-01-02T12:00:00Z') });
  assert.ok(event, 'taze ve güçlü istatistikli düşüş bildirim üretmeli');
  assert.equal(event.topic, 'pattern');
  assert.match(event.body, /medyanı \+%10/);
  assert.match(event.body, /tahmini veya canlı işlem sinyali değildir/);
  // Aynı bölüm → aynı kimlik (tekrar denemeler ignoreDuplicates ile sessizce düşer)
  const again = buildDipAlertEvent({ symbol: 'IONQ', name: 'IonQ', stats: summary.stats, state: summary.state, now: new Date('2026-01-03T09:00:00Z') });
  assert.equal(again.id, event.id);
  // 5 işlem gününden eski giriş artık taze değildir
  assert.equal(buildDipAlertEvent({ symbol: 'IONQ', stats: summary.stats, state: { ...summary.state, daysSinceCross: 9 } }), null);
  // Zayıf istatistik (medyan < +%2) bildirim üretmez
  const weak = { ...summary.stats, horizons: { ...summary.stats.horizons, h5: { ...summary.stats.horizons.h5, medianPct: 1 } } };
  assert.equal(buildDipAlertEvent({ symbol: 'IONQ', stats: weak, state: summary.state }), null);
});

test('desen toplayıcı: 6 saat önbelleği, BIST atlama ve hata toleransı', async () => {
  let chartCalls = 0;
  const yahoo = { async chart(symbol) {
    chartCalls++;
    if (symbol === 'BROKEN') throw new Error('kaynak hatası');
    return { quotes: bars([...syntheticCloses(), 74]).map((bar) => ({ date: `${bar.date}T21:00:00Z`, close: bar.close })) };
  } };
  const cache = new Map();
  const t0 = Date.parse('2026-01-02T12:00:00Z');
  const first = await collectDipPatterns(yahoo, ['IONQ', 'THYAO.IS', 'BROKEN'], { now: t0, cache });
  assert.deepEqual([...first.fresh], ['IONQ']);
  assert.ok(first.bySymbol.get('IONQ').state.bucket === 25);
  assert.equal(first.bySymbol.has('THYAO.IS'), false); // BIST taranmaz
  assert.equal(first.bySymbol.has('BROKEN'), false); // hata alanı boş bırakır
  assert.equal(chartCalls, 2); // IONQ + BROKEN (BIST hiç istenmez)
  // 6 saat içinde ikinci tur: chart ÇAĞRILMAZ, özet önbellekten gelir, fresh boş
  const second = await collectDipPatterns(yahoo, ['IONQ'], { now: t0 + 3600_000, cache });
  assert.equal(chartCalls, 2);
  assert.equal(second.fresh.size, 0);
  assert.ok(second.bySymbol.get('IONQ'));
});

test('bağlam turu: patternStats trade_context verisine girer, uygun düşüş bildirime dönüşür, bildirim hatası turu düşürmez', async () => {
  const series = bars([...syntheticCloses(), 74]);
  const summary = summarizeDipPattern(series, { now: new Date('2026-01-02T12:00:00Z') });
  const upserts = [];
  let failNotifications = false;
  const sb = { from(table) { return { select() { return this; }, in() { return Promise.resolve({ data: [], error: null }); }, upsert(rows, options) {
    if (table === 'notification_events' && failNotifications) return Promise.resolve({ data: null, error: { message: 'topic kısıtı' } });
    upserts.push({ table, rows, options });
    return Promise.resolve({ data: null, error: null });
  } }; } };
  const options = {
    macro: async () => ({ events: [], coverage: {} }),
    intelligence: async () => ({ items: [{ symbol: 'IONQ', name: 'IonQ Inc' }] }),
    patterns: async () => ({ bySymbol: new Map([['IONQ', summary]]), fresh: new Set(['IONQ']) }),
    now: () => Date.parse('2026-01-02T12:00:00Z'),
  };
  await refreshTradeContext(sb, {}, ['IONQ'], options);
  const context = upserts.find((entry) => entry.table === 'trade_context');
  assert.equal(context.rows[0].data.patternStats.state.bucket, 25);
  const alerts = upserts.find((entry) => entry.table === 'notification_events');
  assert.equal(alerts.rows.length, 1);
  assert.equal(alerts.rows[0].topic, 'pattern');
  assert.equal(alerts.options.ignoreDuplicates, true);
  assert.match(alerts.rows[0].data.name, /IonQ/);
  // Bildirim tablosu migration'sız reddederse bağlam yazımı yine tamamlanır
  upserts.length = 0; failNotifications = true;
  await refreshTradeContext(sb, {}, ['IONQ'], options);
  assert.ok(upserts.some((entry) => entry.table === 'trade_context'));
});

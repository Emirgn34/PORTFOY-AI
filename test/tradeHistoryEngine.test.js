import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTradeHistoryPlans, advanceTradeHistory, summarizeTradeHistory } from '../server/tradeHistoryEngine.js';

const MINUTE = 60_000;
const now = Date.parse('2026-11-14T15:00:30Z');
const iso = (value) => new Date(value).toISOString();
const candle = (at, open = 100, high = 101, low = 99, close = 100) => ({ time: iso(at), open, high, low, close, volume: 1000 });
function fixture(live = false) {
  const source = live ? 'licensed-test' : 'Yahoo research';
  const quality = { quoteTime: iso(now - 1000), barTime: iso(Math.floor(now / MINUTE) * MINUTE), source,
    realtime: live, sessionVerified: live, halted: live ? false : null,
    sessionStartsAt: '2026-11-14T14:30:00.000Z', sessionEndsAt: '2026-11-14T15:40:00.000Z' };
  const candidate = { id: 'changes-each-minute', symbol: 'TEST', name: 'Test', market: 'ABD', currency: 'USD', direction: 'long',
    availability: live ? undefined : 'delayed-research', status: live ? 'ready' : 'blocked',
    createdAt: iso(now), expiresAt: iso(now + 10_000), entry: 100, stopLoss: 98,
    metrics: { roundTripCostBps: 20, spreadBps: 10 }, researchAssessment: { hasPlan: true }, dataQuality: quality,
    scenarios: [{ id: 'near', label: 'Yakın hedef', targetPrice: 103, eligible: true }, { id: 'far', label: 'Uzak hedef', targetPrice: 105, eligible: true }] };
  const snapshot = { symbol: 'TEST', bars: [], quote: { price: 100, source, currency: 'USD', marketTime: quality.quoteTime,
    realtime: live, sessionVerified: live, halted: live ? false : null,
    sessionStartsAt: quality.sessionStartsAt, sessionEndsAt: quality.sessionEndsAt } };
  return { candidate, snapshot };
}
function plan(live = false) { const f = fixture(live); return buildTradeHistoryPlans(f.candidate, f.snapshot, { now })[0]; }
function replay(record, bars, clock, snapshot = fixture(record.mode === 'live').snapshot) {
  return advanceTradeHistory(record, { ...snapshot, bars }, { now: clock });
}
const first = Math.ceil(now / MINUTE) * MINUTE;

test('research plan is forward-only, frozen, deduplicated per session, and never created from stale cards', () => {
  const { candidate, snapshot } = fixture();
  const one = buildTradeHistoryPlans(candidate, snapshot, { now })[0];
  assert.equal(one.mode, 'research');
  assert.equal(one.status, 'pending');
  assert.equal(one.entryModel, 'forward-limit');
  assert.equal(one.trackingStartsAt, iso(first));
  assert.equal(one.entryDeadlineAt, iso(now + 30 * MINUTE));
  assert.equal(one.costBps, 30);
  assert.equal(one.trackingEndsAt, snapshot.quote.sessionEndsAt);
  const moved = structuredClone(candidate);
  moved.id = 'new-minute'; moved.entry = 101; moved.scenarios[0].targetPrice = 104;
  const two = buildTradeHistoryPlans(moved, snapshot, { now: now + MINUTE })[0];
  assert.equal(two.id, one.id);
  assert.equal(one.entry, 100);
  assert.equal(one.targets[0].targetPrice, 103);
  assert.deepEqual(buildTradeHistoryPlans(candidate, snapshot, { now: now + 41 * MINUTE }), []);
  assert.deepEqual(buildTradeHistoryPlans(candidate, { ...snapshot, quote: { ...snapshot.quote, currency: 'TRY' } }, { now }), []);
});

test('video observations use stable pivot identity and only fresh zone or confirmed setups', () => {
  const { candidate, snapshot } = fixture();
  candidate.videoStrategies = [{ id: 'channel', title: 'Kanal', dataStatus: 'recent', evaluatedAt: iso(now),
    anchors: { a: { time: '2026-11-14T14:40:00Z', price: 99 }, b: { time: '2026-11-14T14:50:00Z', price: 102 } },
    setups: [{ id: 'short', title: 'Üst kanal', state: 'zone', direction: 'short', levels: { entryLow: 99, entryHigh: 101, stopLoss: 102, targetPrice: 97 } }] }];
  let records = buildTradeHistoryPlans(candidate, snapshot, { now });
  assert.equal(records.length, 2);
  const short = records.find((item) => item.strategyId === 'channel');
  assert.equal(short.entry, 100);
  candidate.videoStrategies[0].setups[0].levels.entryHigh = 102;
  records = buildTradeHistoryPlans(candidate, snapshot, { now });
  assert.equal(records.find((item) => item.strategyId === 'channel').id, short.id);
  candidate.videoStrategies[0].setups[0].state = 'invalidated';
  assert.equal(buildTradeHistoryPlans(candidate, snapshot, { now }).length, 1);
});

test('live core entry is explicitly theoretical and excludes pre-publication partial-candle wins', () => {
  const live = plan(true);
  assert.equal(live.status, 'active');
  assert.equal(live.entryModel, 'quote-reference');
  assert.equal(live.enteredAt, iso(now));
  assert.match(live.executionModel, /varsayımsal/);
  const result = replay(live, [candle(first - MINUTE, 100, 103.5, 99, 102)], first);
  assert.equal(result.targets[0].status, 'ambiguous');
  assert.equal(result.targets[1].status, 'pending');
  assert.equal(result.netReturnPct, null);
  assert.equal(result.status, 'active');
});

test('pre-publication bars and unfinished bars cannot trigger a research entry or outcome', () => {
  const record = plan();
  const result = replay(record, [candle(first - MINUTE, 100, 110, 90), candle(first, 100, 110, 90)], first + MINUTE - 1);
  assert.equal(result.enteredAt, null);
  assert.equal(result.lastBarAt, null);
  assert.equal(result.status, 'pending');
  assert.equal(record.events.length, 1);
});

test('separate targets settle independently, with costs once, preserving a first-target win through later stop', () => {
  const record = plan();
  const input = [candle(first), candle(first + MINUTE, 100, 104, 99, 103), candle(first + 2 * MINUTE, 103, 104, 97, 98)];
  const result = replay(record, input, first + 3 * MINUTE);
  assert.equal(result.targets[0].status, 'target');
  assert.equal(result.targets[0].netReturnPct, 2.7);
  assert.equal(result.targets[1].status, 'stop');
  assert.equal(result.targets[1].netReturnPct, -2.3);
  assert.equal(result.netReturnPct, 2.7);
  assert.equal(result.status, 'target');
  assert.equal(record.status, 'pending');
  assert.equal(replay(result, input, first + 4 * MINUTE), result);
  const summary = summarizeTradeHistory([result]);
  assert.equal(summary.total, 1);
  assert.equal(summary.resolved, 1);
  assert.equal(summary.targetCount, 1);
  assert.equal(summary.winRate, 100);
  assert.equal(summary.averageNetReturnPct, 2.7);
  assert.equal(summary.byTarget.find((target) => target.id === 'far').stopCount, 1);
});

test('entry and exit in one candle is ambiguous unless entry is at the known opening price', () => {
  const sameBar = replay(plan(), [candle(first, 101, 104, 99, 103)], first + MINUTE);
  assert.equal(sameBar.targets[0].status, 'ambiguous');
  const atOpen = replay(plan(), [candle(first, 100, 104, 99, 103)], first + MINUTE);
  assert.equal(atOpen.targets[0].status, 'target');
  assert.equal(atOpen.targets[0].netReturnPct, 2.7);
});

test('target and stop inside one candle never guess order', () => {
  const result = replay(plan(), [candle(first), candle(first + MINUTE, 100, 106, 97)], first + 2 * MINUTE);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.targets[0].netReturnPct, null);
  assert.equal(result.targets[1].status, 'ambiguous');
  const summary = summarizeTradeHistory([result]);
  assert.equal(summary.resolved, 0);
  assert.equal(summary.winRate, null);
});

test('a price gap through stop uses adverse open price; a favorable gap caps at the planned target', () => {
  const stopped = replay(plan(), [candle(first), candle(first + MINUTE, 95, 100, 94, 99)], first + 2 * MINUTE);
  assert.equal(stopped.status, 'stop');
  assert.equal(stopped.netReturnPct, -5.3);
  const won = replay(plan(), [candle(first), candle(first + MINUTE, 106, 107, 97, 100)], first + 2 * MINUTE);
  assert.equal(won.targets[0].status, 'target');
  assert.equal(won.targets[0].exitPrice, 103);
  assert.equal(won.targets[1].exitPrice, 105);
});

test('missing, duplicate or malformed candles are unresolved, never synthetic wins or losses', () => {
  for (const input of [[candle(first + MINUTE)], [candle(first), candle(first)], [{ ...candle(first), high: 90 }]]) {
    const result = replay(plan(), input, first + 2 * MINUTE);
    assert.equal(result.status, 'unresolved');
    assert.equal(result.netReturnPct, null);
  }
  const initial = replay(plan(), [candle(first)], first + MINUTE);
  const same = replay(initial, [candle(first)], first + MINUTE);
  assert.equal(same.events.length, initial.events.length);
  assert.equal(same.lastBarAt, initial.lastBarAt);
});

test('incompatible source, mode, symbol or currency cannot score a licensed observation', () => {
  const live = plan(true);
  for (const patch of [{ source: 'other-feed' }, { currency: 'TRY' }, { realtime: false }, { sessionVerified: false }, { halted: true }]) {
    const snapshot = fixture(true).snapshot;
    Object.assign(snapshot.quote, patch);
    const result = replay(live, [candle(first - MINUTE), candle(first, 100, 110, 99)], first + MINUTE, snapshot);
    assert.equal(result.targets[0].status, 'pending');
    assert.equal(result.lastBarAt, null);
  }
  const result = replay(live, [candle(first - MINUTE)], first, { ...fixture(true).snapshot, symbol: 'OTHER' });
  assert.equal(result.lastBarAt, null);
});

test('short returns have the correct sign and use the same single cost deduction', () => {
  const record = plan();
  record.direction = 'short'; record.stopLoss = 102;
  record.targets = [{ id: 'short', label: 'Short hedef', targetPrice: 97, status: 'pending', hitAt: null, exitPrice: null, netReturnPct: null }];
  const result = replay(record, [candle(first), candle(first + MINUTE, 100, 101, 96, 97)], first + 2 * MINUTE);
  assert.equal(result.status, 'target');
  assert.equal(result.netReturnPct, 2.7);
});

test('fully observed unfilled entry window expires without a loss; missing coverage waits then becomes unresolved', () => {
  const record = plan();
  const bars = Array.from({ length: 29 }, (_, index) => candle(first + index * MINUTE, 101, 102, 100.5, 101));
  const full = replay(record, bars, now + 31 * MINUTE);
  assert.equal(full.status, 'expired');
  assert.equal(full.enteredAt, null);
  assert.equal(full.netReturnPct, null);
  const waiting = advanceTradeHistory(record, {}, { now: now + 31 * MINUTE });
  assert.equal(waiting.status, 'pending');
  const missing = advanceTradeHistory(record, {}, { now: now + 61 * MINUTE });
  assert.equal(missing.status, 'unresolved');
  assert.equal(summarizeTradeHistory([full, missing]).stopCount, 0);
});

test('window-end model close requires complete coverage; timeout without bars is unresolved', () => {
  const record = plan();
  record.trackingEndsAt = iso(first + 2 * MINUTE);
  const result = replay(record, [candle(first), candle(first + MINUTE, 100, 102, 99, 101)], first + 2 * MINUTE);
  assert.equal(result.status, 'expired');
  assert.equal(result.netReturnPct, 0.7);
  assert.equal(summarizeTradeHistory([result]).resolved, 0);
  const active = replay(plan(), [candle(first)], first + MINUTE);
  const missing = advanceTradeHistory(active, {}, { now: Date.parse(active.trackingEndsAt) + 31 * MINUTE });
  assert.equal(missing.status, 'unresolved');
  assert.equal(missing.netReturnPct, null);
});

test('summary counts primary scenario once, even when further targets are still being tracked', () => {
  const active = replay(plan(), [candle(first, 100, 104, 99, 103)], first + MINUTE);
  assert.equal(active.status, 'active');
  const summary = summarizeTradeHistory([active]);
  assert.equal(summary.active, 1);
  assert.equal(summary.completed, 0);
  assert.equal(summary.resolved, 1);
  assert.equal(summary.targetCount, 1);
  assert.equal(summary.averageNetReturnPct, 2.7);
});

test('delayed research is archived at publication wall-clock, never at the old quote time', () => {
  const { candidate, snapshot } = fixture();
  snapshot.quote.marketTime = iso(now - 16 * MINUTE);
  candidate.dataQuality.quoteTime = snapshot.quote.marketTime;
  candidate.dataQuality.barTime = iso(Math.floor(now / MINUTE) * MINUTE - 16 * MINUTE);
  const record = buildTradeHistoryPlans(candidate, snapshot, { now })[0];
  assert.ok(record);
  assert.equal(record.createdAt, iso(now));
  assert.equal(record.trackingStartsAt, iso(first));
  assert.equal(replay(record, [candle(first - 15 * MINUTE, 100, 110, 90)], first + MINUTE).status, 'pending');
  snapshot.quote.marketTime = iso(now - 31 * MINUTE);
  assert.deepEqual(buildTradeHistoryPlans(candidate, snapshot, { now }), []);
});

test('mean includes entered time exits and their loss; rates still count only target or stop', () => {
  const expired = plan();
  expired.trackingEndsAt = iso(first + 2 * MINUTE);
  const loss = replay(expired, [candle(first), candle(first + MINUTE, 100, 101, 98.5, 99)], first + 2 * MINUTE);
  assert.equal(loss.status, 'expired');
  assert.equal(loss.netReturnPct, -1.3);
  const win = replay(plan(), [candle(first, 100, 104, 99, 103)], first + MINUTE);
  const summary = summarizeTradeHistory([win, loss]);
  assert.equal(summary.resolved, 1);
  assert.equal(summary.settledCount, 2);
  assert.equal(summary.winRate, 100);
  assert.equal(summary.averageNetReturnPct, 0.7);
  assert.equal(summary.byTarget.find((target) => target.id === 'near').settledCount, 2);
});

test('seconds-bearing fallback and provider ends use the last complete minute and settle their final close', () => {
  const { candidate, snapshot } = fixture();
  delete snapshot.quote.sessionEndsAt;
  delete candidate.dataQuality.sessionEndsAt;
  const record = buildTradeHistoryPlans(candidate, snapshot, { now })[0];
  const expectedEnd = Math.floor((now + 6 * 60 * MINUTE) / MINUTE) * MINUTE;
  assert.equal(record.trackingEndsAt, iso(expectedEnd));
  const count = (expectedEnd - first) / MINUTE;
  const bars = Array.from({ length: count }, (_, index) => candle(first + index * MINUTE, 100, 101, 99, index === count - 1 ? 99 : 100));
  const result = replay(record, bars, expectedEnd, snapshot);
  assert.equal(result.status, 'expired');
  assert.equal(result.closedAt, iso(expectedEnd));
  assert.equal(result.netReturnPct, -1.3);
  assert.equal(result.lastBarAt, iso(expectedEnd - MINUTE));

  snapshot.quote.sessionEndsAt = '2026-11-14T15:40:37.000Z';
  const providerPlan = buildTradeHistoryPlans(candidate, snapshot, { now })[0];
  assert.equal(providerPlan.trackingEndsAt, '2026-11-14T15:40:00.000Z');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeSignalEpisodes,
  forwardTradingClose,
  summarizeReturns,
} from '../server/backtestMetrics.js';

test('ileri kapanışı takvim değil işlem seansı sayısıyla seçer', () => {
  const closes = [1, 2, 5, 6].map((day, index) => ({
    t: Date.UTC(2026, 0, day),
    close: 100 + index,
  }));
  const end = forwardTradingClose(closes, Date.UTC(2026, 0, 1, 12), 2);
  assert.equal(end.t, Date.UTC(2026, 0, 5));
});

test('aynı günlük sinyalin ilk snapshotını tek epizot olarak tutar', () => {
  const snapshots = [
    { symbol: 'AAPL', market: 'US', horizon: 'short', captured_at: '2026-01-01T12:00:00Z' },
    { symbol: 'AAPL', market: 'US', horizon: 'short', captured_at: '2026-01-01T06:00:00Z' },
    { symbol: 'AAPL', market: 'US', horizon: 'short', captured_at: '2026-01-02T06:00:00Z' },
  ];
  const deduped = dedupeSignalEpisodes(snapshots);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].captured_at, '2026-01-01T06:00:00Z');
});

test('işlem maliyetini net getiri ve excess getiriden düşer', () => {
  const summary = summarizeReturns([0.02, -0.01], [0.01, -0.02], 25);
  assert.equal(Number(summary.netMean.toFixed(4)), 0.0025);
  assert.equal(Number(summary.excessMeanNet.toFixed(4)), -0.0075);
});

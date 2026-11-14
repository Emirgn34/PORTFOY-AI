import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateVideoStrategies } from '../server/videoStrategies.js';

const minute = 60_000;
const start = Date.parse('2026-11-12T14:30:00Z');
const iso = (value) => new Date(value).toISOString();
function series(points) {
  const count = points.at(-1)[0] + 1;
  return Array.from({ length: count }, (_, index) => {
    const left = points.findLast((point) => point[0] <= index);
    const right = points.find((point) => point[0] >= index);
    const close = left[0] === right[0] ? left[1] : left[1] + (right[1] - left[1]) * (index - left[0]) / (right[0] - left[0]);
    const prior = index ? points.findLast((point) => point[0] < index) : left;
    const open = close + (close >= prior[1] ? -0.05 : 0.05);
    return { time: iso(start + index * minute), open, close, high: close + 0.1, low: close - 0.1, volume: 1000 };
  });
}
const clockFor = (bars) => Date.parse(bars.at(-1).time) + minute + 1000;
const firstBars = () => series([[0, 99], [10, 102], [20, 98], [30, 104], [41, 100.5], [42, 100.8]]);
const channelBars = (short = false) => series(short
  ? [[0, 100], [10, 98], [20, 104], [30, 100], [35, 106], [39, 105.8], [40, 105.6]]
  : [[0, 100], [10, 98], [20, 104], [30, 100], [35, 102], [39, 100.9], [40, 101.1]]);

test('video interpretations return source links and wait without enough completed data', () => {
  const result = evaluateVideoStrategies({ symbol: 'TEST', bars: firstBars().slice(0, 20) }, { now: start + 25 * minute });
  assert.equal(result.length, 2);
  for (const strategy of result) {
    assert.equal(strategy.state, 'waiting');
    assert.equal(strategy.levels, null);
    assert.equal(strategy.actionable, false);
    assert.equal(strategy.dataStatus, 'insufficient');
    assert.ok(strategy.sourceUrl.startsWith('https://x.com/'));
    assert.ok(strategy.assumptions.some((text) => text.includes('varsayımı')));
  }
});

test('closed CHoCH and bullish 50–61.8 pullback create a bounded research setup', () => {
  const bars = firstBars();
  const setup = evaluateVideoStrategies({ symbol: 'TEST', bars }, { now: clockFor(bars) })[0];
  assert.equal(setup.state, 'confirmed');
  assert.equal(setup.direction, 'long');
  assert.equal(setup.actionable, false);
  assert.ok(setup.levels.entryLow < setup.levels.entryHigh);
  assert.ok(setup.levels.stopLoss < setup.levels.entryLow);
  assert.ok(setup.levels.targetPrice > setup.levels.entryHigh);
  const range = setup.anchors.impulseHigh.price - setup.anchors.swingLow.price;
  assert.ok(Math.abs(setup.levels.entryLow - (setup.anchors.impulseHigh.price - 0.618 * range)) < 0.00001);
  assert.ok(setup.chart.lines.some((line) => line.label === 'CHoCH'));
  assert.ok(setup.anchors.impulseHigh.index <= bars.length - 3);
});

test('future and explicitly unclosed bars cannot repaint a current strategy', () => {
  const bars = firstBars(), now = clockFor(bars);
  const baseline = evaluateVideoStrategies({ bars }, { now });
  const future = { time: iso(now + minute), open: 1000, high: 2000, low: 900, close: 1500, volume: 1e9 };
  const unclosed = { ...future, time: iso(start + 15 * minute), closed: false };
  assert.deepEqual(evaluateVideoStrategies({ bars: [...bars, future, unclosed] }, { now }), baseline);
  const unfinished = firstBars().slice(0, 31);
  assert.equal(evaluateVideoStrategies({ bars: unfinished }, { now: clockFor(unfinished) })[0].levels, null);
});

test('wick-only previous-high break does not produce CHoCH levels', () => {
  const bars = firstBars();
  for (let index = 21; index <= 40; index++) {
    bars[index].close = Math.min(bars[index].close, 101.9);
    bars[index].open = Math.min(bars[index].open, 101.8);
    bars[index].low = Math.min(bars[index].low, bars[index].open, bars[index].close);
  }
  const setup = evaluateVideoStrategies({ bars }, { now: clockFor(bars) })[0];
  assert.equal(setup.state, 'waiting');
  assert.equal(setup.levels, null);
  assert.match(setup.reasons.join(' '), /kapanış/);
});

test('lower ascending channel supports long and upper 0.786 region supports separate short interpretation', () => {
  for (const direction of ['long', 'short']) {
    const bars = channelBars(direction === 'short');
    const strategy = evaluateVideoStrategies({ bars }, { now: clockFor(bars) })[1];
    assert.equal(strategy.setups.length, 2);
    assert.equal(strategy.state, 'confirmed');
    assert.equal(strategy.direction, direction);
    assert.equal(strategy.setups.find((setup) => setup.direction === direction).state, 'confirmed');
    assert.equal(strategy.actionable, false);
    for (const setup of strategy.setups) {
      assert.ok(Object.values(setup.levels).every(Number.isFinite));
      assert.ok(setup.direction === 'long' ? setup.levels.stopLoss < setup.levels.entryLow : setup.levels.stopLoss > setup.levels.entryHigh);
    }
    assert.ok(strategy.assumptions.some((text) => text.includes('birebir video formülü iddiası yoktur')));
  }
});

test('bearish or flat geometry does not become an ascending channel by relabeling pivots', () => {
  for (const bars of [series([[0, 104], [10, 102], [20, 106], [30, 100], [35, 102], [40, 101]]),
    series([[0, 100], [40, 100]])]) {
    const result = evaluateVideoStrategies({ bars }, { now: clockFor(bars) })[1];
    assert.equal(result.state, 'waiting');
    assert.equal(result.levels, null);
  }
});

test('stop penetration invalidates the first setup; stale candles cannot claim present confirmation', () => {
  const bars = firstBars(), now = clockFor(bars);
  const stale = evaluateVideoStrategies({ bars }, { now: now + 6 * minute })[0];
  assert.equal(stale.state, 'waiting');
  assert.equal(stale.patternState, 'confirmed');
  assert.equal(stale.dataStatus, 'stale');
  const stopped = firstBars();
  stopped.at(-1).low = 99.8;
  assert.equal(evaluateVideoStrategies({ bars: stopped }, { now })[0].state, 'invalidated');
});

test('duplicate, malformed, or interrupted data cannot create false channel continuity', () => {
  const original = firstBars();
  const duplicate = [...original, { ...original[20] }];
  const bad = original.map((bar, index) => index === 25 ? { ...bar, high: 0 } : bar);
  const gap = original.filter((_, index) => index !== 25);
  for (const bars of [duplicate, bad, gap]) {
    const result = evaluateVideoStrategies({ bars }, { now: clockFor(original) });
    assert.ok(result.every((strategy) => strategy.state === 'waiting' && strategy.levels === null));
  }
});

test('later volatility cannot widen a fixed stop or reactivate a breached first setup', () => {
  const bars = firstBars();
  const baseline = evaluateVideoStrategies({ bars }, { now: clockFor(bars) })[0];
  bars.at(-1).low = baseline.levels.stopLoss - 0.05;
  const stopped = evaluateVideoStrategies({ bars }, { now: clockFor(bars) })[0];
  assert.equal(stopped.state, 'invalidated');
  const originalLength = bars.length;
  for (let index = 0; index < 8; index++) {
    bars.push({ time: iso(start + (originalLength + index) * minute), open: 100.7, close: 100.8,
      high: 103.8, low: 99.9, volume: 1000 });
  }
  const volatile = evaluateVideoStrategies({ bars }, { now: clockFor(bars) })[0];
  assert.equal(volatile.anchors.impulseHigh.time, baseline.anchors.impulseHigh.time);
  assert.deepEqual(volatile.levels, baseline.levels);
  assert.equal(volatile.state, 'invalidated');
});

test('an observed channel break remains invalid for the same confirmed anchors', () => {
  const bars = channelBars();
  const baseline = evaluateVideoStrategies({ bars }, { now: clockFor(bars) })[1];
  bars.at(-1).low = baseline.setups[0].levels.stopLoss - 0.1;
  assert.equal(evaluateVideoStrategies({ bars }, { now: clockFor(bars) })[1].state, 'invalidated');
  bars.push({ time: iso(start + bars.length * minute), open: 101.05, close: 101.2, high: 101.3, low: 101, volume: 1000 });
  const returned = evaluateVideoStrategies({ bars }, { now: clockFor(bars) })[1];
  assert.equal(returned.anchors.secondLow.time, baseline.anchors.secondLow.time);
  assert.equal(returned.state, 'invalidated');
});

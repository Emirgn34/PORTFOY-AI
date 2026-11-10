import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTradeCandidate, isTradeCandidateFresh } from '../server/tradeEngine.js';

const now = Date.parse('2026-11-11T15:30:05Z');
const iso = (ms) => new Date(ms).toISOString();
function snapshot() {
  const start = now - 65_000 - 59 * 60_000;
  const bars = Array.from({ length: 60 }, (_, i) => {
    const close = 100 + i * 0.015 + Math.sin(i * 1.4) * 0.09;
    return { time: iso(start + i * 60_000), open: close - 0.01, high: close + 0.09,
      low: close - 0.09, close, volume: i > 56 ? 20_000 : 10_000 };
  });
  const price = bars.at(-1).close;
  return { symbol: 'TEST', bars, quote: { price, bid: price - 0.01, ask: price + 0.01,
    currency: 'USD', name: 'Test Company', marketTime: iso(now - 500), receivedAt: iso(now - 100),
    realtime: true, source: 'licensed-test-feed', barIntervalSeconds: 60, marketState: 'REGULAR', sessionVerified: true, halted: false,
    sessionStartsAt: iso(start), sessionEndsAt: iso(now + 4 * 3_600_000) }, context: {} };
}

test('verified completed minute bars generate a cost-aware setup; score is not probability', () => {
  const candidate = buildTradeCandidate(snapshot(), { now });
  assert.deepEqual(candidate.blockers, []);
  assert.equal(candidate.status, 'ready');
  assert.ok(isTradeCandidateFresh(candidate, now));
  assert.ok(candidate.metrics.relativeVolume >= 1.2);
  assert.ok(candidate.reasons.length >= 3);
  assert.equal(candidate.metrics.barsUsed, 60);
  assert.equal(candidate.scenarios.length, 3);
  assert.ok(candidate.scenarios[0].eligible);
  assert.ok(candidate.scenarios[0].netRewardRisk >= 1.5);
  assert.ok(candidate.entry > candidate.stopLoss);
  assert.ok(candidate.scenarios.every((scenario) => scenario.targetPrice > candidate.entry));
  assert.ok(candidate.warnings.some((warning) => warning.includes('başarı olasılığı değildir')));
  const netRatio = (candidate.scenarios[0].targetPrice - candidate.entry - candidate.metrics.estimatedCostPerShare)
    / (candidate.entry - candidate.stopLoss + candidate.metrics.estimatedCostPerShare);
  assert.ok(Math.abs(netRatio - candidate.scenarios[0].netRewardRisk) < 0.01);
});

test('source market time, receive time and hard age ceilings cannot be bypassed by cache refresh', () => {
  for (const patch of [
    { marketTime: iso(now - 16_000), receivedAt: iso(now) },
    { marketTime: undefined }, { marketTime: iso(now + 3000) },
    { receivedAt: undefined }, { receivedAt: iso(now - 10_000) },
    { realtime: false }, { source: '' }, { marketTime: '2026-11-11 15:30:05' },
  ]) {
    const input = snapshot(); Object.assign(input.quote, patch);
    const result = buildTradeCandidate(input, { now, maxQuoteAgeMs: 3_600_000 });
    assert.equal(result.status, 'blocked', JSON.stringify(patch));
    assert.ok(!isTradeCandidateFresh(result, now));
  }
});

test('unknown/closed/halted sessions, wrong currency and bad spreads block trades', () => {
  for (const patch of [{ sessionVerified: false }, { halted: undefined }, { halted: true },
    { marketState: 'CLOSED' }, { sessionStartsAt: undefined }, { sessionEndsAt: undefined },
    { sessionEndsAt: iso(now + 20 * 60_000) }, { bid: 99, ask: 101 }, { bid: 102, ask: 101 },
    { ask: null }, { currency: 'TRY' }, { barIntervalSeconds: undefined }, { barIntervalSeconds: 300 }]) {
    const input = snapshot(); Object.assign(input.quote, patch);
    assert.equal(buildTradeCandidate(input, { now }).status, 'blocked', JSON.stringify(patch));
  }
});

test('unfinished future bar does not leak into indicators; invalid bars, gaps and duplicates block', () => {
  const input = snapshot();
  const baseline = buildTradeCandidate(input, { now });
  input.bars.push({ time: iso(now - 5000), open: 1000, high: 1500, low: 900, close: 1200, volume: 1e9 });
  assert.deepEqual(buildTradeCandidate(input, { now }).metrics, baseline.metrics);
  for (const mutate of [
    (data) => { data.bars[20].close = NaN; },
    (data) => { data.bars[20].volume = -1; },
    (data) => { data.bars.splice(30, 1); },
    (data) => { data.bars.shift(); },
    (data) => { data.bars = data.bars.map((bar) => ({ ...bar, time: iso(Date.parse(bar.time) + 1000) })); },
    (data) => { data.bars.push({ ...data.bars[40] }); },
    (data) => { data.bars = data.bars.slice(-39); },
    (data) => { data.bars = data.bars.map((bar) => ({ ...bar, time: iso(Date.parse(bar.time) - 120_000) })); },
  ]) {
    const changed = snapshot(); mutate(changed);
    assert.equal(buildTradeCandidate(changed, { now }).status, 'blocked');
  }
});

test('low liquidity, zero volume, excessive costs or insufficient target time block', () => {
  const illiquid = snapshot(); illiquid.bars.forEach((bar) => { bar.volume = 1; });
  assert.equal(buildTradeCandidate(illiquid, { now }).status, 'blocked');
  const noVolume = snapshot(); noVolume.bars.forEach((bar) => { bar.volume = 0; });
  assert.equal(buildTradeCandidate(noVolume, { now }).status, 'blocked');
  assert.equal(buildTradeCandidate(snapshot(), { now, roundTripCostBps: 1000 }).status, 'blocked');
  const close = snapshot(); close.quote.sessionEndsAt = iso(now + 31 * 60_000);
  assert.ok(buildTradeCandidate(close, { now }).scenarios.every((scenario) => !scenario.eligible));
});

test('nearby earnings/macro events block; future or old news cannot inflate evidence or score', () => {
  const input = snapshot();
  const baseline = buildTradeCandidate(input, { now });
  input.context = { news: [
    { title: 'future', publishedAt: iso(now + 1), link: 'https://example.com/future' },
    { title: 'old', publishedAt: iso(now - 25 * 3_600_000) },
    { title: 'valid', published_at: iso(now - 10_000), link: 'javascript:alert(1)', publisher: 'source' },
  ] };
  const news = buildTradeCandidate(input, { now });
  assert.equal(news.context.news.length, 1); assert.equal(news.context.news[0].title, 'valid');
  assert.equal(news.context.news[0].url, null); assert.equal(news.score, baseline.score);
  input.context.intelligence = { earningsDate: iso(now + 6 * 3_600_000) };
  assert.equal(buildTradeCandidate(input, { now }).status, 'blocked');
  input.context.intelligence = { earnings: { date: iso(now + 6 * 3_600_000) } };
  assert.equal(buildTradeCandidate(input, { now }).status, 'blocked');
  input.context.intelligence = { earnings: { date: '2026-11-11' } };
  assert.equal(buildTradeCandidate(input, { now }).status, 'blocked');
  input.context = { macroEvents: [{ time: iso(now + 10 * 60_000), impact: 'high' }] };
  assert.equal(buildTradeCandidate(input, { now }).status, 'blocked');
});

test('expiry uses the oldest market timestamp and expires without a new request', () => {
  const input = snapshot(); input.quote.marketTime = iso(now - 14_000); input.quote.receivedAt = iso(now - 13_500);
  const candidate = buildTradeCandidate(input, { now });
  assert.equal(candidate.expiresAt, iso(now + 1000));
  assert.equal(isTradeCandidateFresh(candidate, now + 999), true);
  assert.equal(isTradeCandidateFresh(candidate, now + 1000), false);
  const next = structuredClone(input); next.quote.marketTime = iso(now - 100); next.quote.receivedAt = iso(now);
  assert.equal(buildTradeCandidate(next, { now }).id, candidate.id, 'same completed-bar setup is idempotent');
  next.bars.at(-1).time = iso(Date.parse(next.bars.at(-1).time) + 60_000);
  assert.notEqual(buildTradeCandidate(next, { now: now + 60_000 }).id, candidate.id);
});

test('a bearish or unconfirmed setup remains watch, never an actionable buy', () => {
  const input = snapshot();
  input.bars = input.bars.map((bar, i) => {
    const close = 101 - i * 0.015 + Math.sin(i * 1.4) * 0.09;
    return { ...bar, open: close - 0.01, high: close + 0.09, low: close - 0.09, close };
  });
  const price = input.bars.at(-1).close;
  Object.assign(input.quote, { price, bid: price - 0.01, ask: price + 0.01 });
  const candidate = buildTradeCandidate(input, { now });
  assert.equal(candidate.status, 'watch'); assert.equal(isTradeCandidateFresh(candidate, now), false);
});

test('mismatched source currency never relabels a numeric entry as USD or exposes trade levels',()=>{
  const input=snapshot();input.quote.currency='EUR';
  const candidate=buildTradeCandidate(input,{now});
  assert.equal(candidate.status,'blocked');assert.equal(candidate.currency,null);
  assert.equal(candidate.entry,null);assert.equal(candidate.stopLoss,null);assert.deepEqual(candidate.scenarios,[]);
  assert.equal(candidate.dataQuality.expectedCurrency,'USD');assert.equal(candidate.dataQuality.quoteCurrency,'EUR');
  assert.equal(candidate.dataQuality.currencyVerified,false);
});

test('tiny quoted prices cannot round entry and stop to the same level and become actionable',()=>{
  const input=snapshot();
  for (const key of ['price','bid','ask']) input.quote[key]/=1_000_000;
  input.bars=input.bars.map((bar)=>({...bar,open:bar.open/1_000_000,high:bar.high/1_000_000,
    low:bar.low/1_000_000,close:bar.close/1_000_000,volume:bar.volume*1_000_000}));
  const candidate=buildTradeCandidate(input,{now});
  assert.equal(candidate.status,'blocked');assert.match(candidate.blockers.join(' '),/Fiyat hassasiyeti/);
  assert.equal(candidate.entry,null);assert.equal(candidate.stopLoss,null);assert.deepEqual(candidate.scenarios,[]);
});

test('a known macro release inside the holding window remains visible and blocks overlapping targets', () => {
  const input = snapshot();
  input.context.macroEvents = [{ title: 'Yüksek etkili açıklama', date: iso(now + 60 * 60_000), impact: 'high' }];
  const candidate = buildTradeCandidate(input, { now });
  assert.equal(candidate.status, 'blocked');
  assert.equal(candidate.context.macroEvents[0].title, 'Yüksek etkili açıklama');
  assert.ok(candidate.scenarios.every((scenario) => !scenario.eligible));
  assert.match(candidate.scenarios[0].ineligibleReason, /makro veri/);
  assert.ok(candidate.blockers.some((message) => message.includes('Makro veri açıklaması')));
  assert.equal(isTradeCandidateFresh(candidate, now), false);
});

test('a shorter safe target can remain ready while a longer target overlaps an upcoming macro release', () => {
  const input = snapshot();
  input.context.macroEvents = [{ title: 'Daha sonraki açıklama', startsAt: iso(now + 150 * 60_000), importance: 'critical' }];
  const candidate = buildTradeCandidate(input, { now });
  assert.equal(candidate.status, 'ready');
  assert.equal(candidate.scenarios[0].eligible, true);
  assert.equal(candidate.scenarios[1].eligible, false);
  assert.match(candidate.scenarios[1].ineligibleReason, /makro veri/);
  assert.equal(candidate.context.macroEvents.length, 1);
  assert.deepEqual(candidate.estimatedHours, candidate.scenarios[0].estimatedHours);
});

test('current macro blackout stays enforced; malformed calendar entries cannot create valid events', () => {
  const input = snapshot();
  input.context.macroEvents = [null, { date: 'unknown', impact: 'high' }, { date: iso(now), impact: 'medium' }];
  input.context.news = [null];
  const clean = buildTradeCandidate(input, { now });
  assert.equal(clean.status, 'ready');
  assert.deepEqual(clean.context.macroEvents, []);
  for (const minutes of [-20, 20]) {
    input.context.macroEvents = [{ date: iso(now + minutes * 60_000), impact: 'high' }];
    const blocked = buildTradeCandidate(input, { now });
    assert.equal(blocked.status, 'blocked');
    assert.ok(blocked.blockers.some((message) => message.includes('Yüksek etkili makro veri penceresinde')));
  }
});

test('null legacy quote/context values return a blocked result instead of crashing', () => {
  const blocked = buildTradeCandidate({ symbol: 'TEST', quote: null, context: null, bars: null }, { now });
  assert.equal(blocked.status, 'blocked');
  assert.ok(blocked.blockers.includes('Fiyat para birimi doğrulanamadı.'));
  const input = snapshot(); input.context = null;
  assert.equal(buildTradeCandidate(input, { now }).status, 'ready');
});

test('overflowing volume or derived indicators cannot become ready or expose non-finite numbers', () => {
  function finiteNumbers(value) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
    else if (value && typeof value === 'object') Object.values(value).forEach(finiteNumbers);
  }
  const volume = snapshot(); volume.bars.forEach((bar) => { bar.volume = Number.MAX_VALUE; });
  const blockedVolume = buildTradeCandidate(volume, { now });
  assert.equal(blockedVolume.status, 'blocked'); finiteNumbers(blockedVolume);
  const prices = snapshot();
  prices.bars.forEach((bar) => { for (const key of ['open', 'high', 'low', 'close']) bar[key] *= 5e300; });
  for (const key of ['price', 'bid', 'ask']) prices.quote[key] *= 5e300;
  const blockedPrices = buildTradeCandidate(prices, { now });
  assert.equal(blockedPrices.status, 'blocked');
  assert.ok(blockedPrices.blockers.some((message) => message.includes('geçersiz sayısal değer')));
  finiteNumbers(blockedPrices);
});

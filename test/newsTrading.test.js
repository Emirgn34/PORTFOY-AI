import test from 'node:test';
import assert from 'node:assert/strict';
import { newsPriceContext, summarizeNewsForTrading } from '../server/newsTrading.js';
import { calculateNewsPosition } from '../src/utils/newsTrading.js';

const now = new Date('2026-11-14T12:00:00Z');
function chart() {
  return { meta: { currency: 'USD' }, quotes: Array.from({ length: 70 }, (_, i) => {
    const close = 100 + i / 3 + Math.sin(i) * 2;
    return { date: new Date(now.getTime() - (70 - i) * 86400_000), close, adjclose: close, high: close + 2, low: close - 2 };
  }) };
}
function article(title, overrides = {}) {
  return { id: title, symbol: 'AAPL', title, publisher: 'Reuters', link: 'https://example.com/news', publishedAt: '2026-11-14T10:00:00Z', ...overrides };
}

test('fiyat aralıkları ölçülen oynaklıktan gelir, uzun ufuk genişler ve veri tarihi saklanır', () => {
  const price = newsPriceContext(chart(), { now });
  assert.equal(price.available, true);
  assert.equal(price.sampleSessions, 60);
  assert.equal(price.currency, 'USD');
  assert.ok(price.ranges[1].low < price.ranges[0].low);
  assert.ok(price.ranges[1].high > price.ranges[0].high);
  assert.ok(price.illustrativeStop < price.price);
  assert.match(price.method, /fiyat hedefi değildir/);
  assert.equal(price.asOf, '2026-11-13T12:00:00.000Z');
});

test('az veya bayat geçmiş, şirket işlemi kopukluğu ve sabit fiyat hayali fiyat bandı üretmez', () => {
  assert.equal(newsPriceContext({ quotes: [] }, { now }).available, false);
  const stale = chart(); stale.quotes = stale.quotes.map((q) => ({ ...q, date: '2026-09-01' }));
  assert.equal(newsPriceContext(stale, { now }).available, false);
  const split = chart(); split.quotes[40].adjclose = 1;
  assert.equal(newsPriceContext(split, { now }).available, false);
  const flat = chart(); flat.quotes = flat.quotes.map((q) => ({ ...q, close: 100, adjclose: 100 }));
  assert.equal(newsPriceContext(flat, { now }).available, false);
});

test('gelecek günler ve seans kapanmadan oluşan günlük mum oynaklığa katılmaz', () => {
  const forming = chart();
  const previousPrice = forming.quotes.at(-1).close;
  forming.quotes.push({ date: new Date('2026-11-14T11:00:00Z'), close: 150, adjclose: 150, high: 155, low: 145 });
  forming.quotes.push({ date: new Date('2026-11-15T12:00:00Z'), close: 200, adjclose: 200, high: 205, low: 195 });
  forming.meta.currentTradingPeriod = { regular: { start: new Date('2026-11-14T10:00:00Z'), end: new Date('2026-11-14T17:00:00Z') } };
  const result = newsPriceContext(forming, { now });
  assert.equal(result.available, true); assert.equal(result.price, previousPrice);
});

test('özet sadece yeni, tarihli haberleri kullanır; söylenti olumluluk üretmez', () => {
  const result = summarizeNewsForTrading([
    article('Company may raise guidance'), article('Old record revenue', { publishedAt: '2026-10-01' }),
    article('Future record revenue', { publishedAt: '2026-11-15' }), article('Unknown date', { publishedAt: null }),
  ], { symbol: 'AAPL', chart: chart(), now });
  assert.equal(result.articleCount, 1);
  assert.equal(result.evidence[0].sentiment, 'neutral');
  assert.equal(result.bias, 'neutral');
  assert.match(result.condition, /%0/);
});

test('olumlu ve olumsuz başlık karıştığında yeni uzun tahsis önerilmez; kaynaklar korunur', () => {
  const result = summarizeNewsForTrading([article('Company raises guidance'), article('Company cuts guidance')], { symbol: 'AAPL', chart: chart(), now });
  assert.equal(result.bias, 'neutral');
  assert.match(result.condition, /%0/);
  assert.equal(result.evidence[0].link, 'https://example.com/news');
  assert.match(result.themes[0].longTerm, /nakit akışı/);
});

test('sektöre uydurma hisse fiyatı atamaz ve habersiz işlem etkisi üretmez', () => {
  const result = summarizeNewsForTrading([article('Sector record revenue')], { query: 'semiconductors', now });
  assert.equal(result.priceContext.available, false);
  assert.match(result.priceContext.reason, /bir hisse seçin/);
  const empty = summarizeNewsForTrading([], { symbol: 'AAPL', now });
  assert.equal(empty.evidence.length, 0); assert.equal(empty.themes.length, 0);
});

test('pozisyon hesabı risk, tahsis ve maliyet sınırını birlikte uygular', () => {
  const size = calculateNewsPosition({ capital: 10000, riskPercent: 1, allocationPercent: 10, entry: 100, stop: 98, costBps: 20 });
  assert.equal(size.units, 9);
  assert.ok(size.estimatedLoss <= 100);
  assert.ok(size.budgetUsed <= 1000);
  assert.ok(size.allocationPercent <= 10);
  const risk = calculateNewsPosition({ capital: 10000, riskPercent: .1, allocationPercent: 100, entry: 100, stop: 98, costBps: 20 });
  assert.equal(risk.units, 4);
});

test('eksik sermaye, ters zarar kes veya geçersiz risk sayısal boyut üretmez', () => {
  const valid = { capital: 1000, riskPercent: .5, allocationPercent: 10, entry: 100, stop: 95 };
  for (const invalid of [{ capital: '' }, { capital: -1 }, { riskPercent: 6 }, { stop: 100 }, { stop: 101 }, { entry: NaN }, { costBps: -1 }]) {
    assert.equal(calculateNewsPosition({ ...valid, ...invalid }), null);
  }
});

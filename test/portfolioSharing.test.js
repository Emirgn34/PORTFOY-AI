import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getShareAllocation, renderPortfolioShareSvg } from '../src/utils/portfolioShare.js';
import { movePortfolioStock } from '../src/utils/portfolioOrder.js';

test('share projection contains only grouped symbols and percentages summing to 100', () => {
  const result = getShareAllocation([
    { name: 'AAPL', percent: 25, value: 987654, price: 12345, quantity: 99, user_id: 'private-user' },
    { name: 'AAPL', percent: 25, value: 987654 },
    { name: 'MSFT', percent: 50, value: 987654 },
    { name: 'ZERO', percent: 0 }, { name: 'BAD', percent: NaN },
  ]);
  assert.deepEqual(result, [{ label: 'AAPL', percent: 50 }, { label: 'MSFT', percent: 50 }]);
  const thirds = getShareAllocation(['A', 'B', 'C'].map((name) => ({ name, percent: 1 })));
  assert.deepEqual(thirds.map((item) => item.percent), [33.4, 33.3, 33.3]);
  assert.equal(thirds.reduce((sum, item) => sum + Math.round(item.percent * 10), 0), 1000);
});

test('export excludes money and user fields, escapes symbols, and includes every holding', () => {
  const { svg, width, height } = renderPortfolioShareSvg([
    { name: '<script>"&', percent: 40, value: 987654321, price: 123456, user_id: 'private-user' },
    { name: 'MSFT', percent: 60 },
  ]);
  assert.equal(width, 1080);
  assert.equal(height, 1350);
  assert.match(svg, /&lt;script&gt;&quot;&amp;/);
  assert.match(svg, /60,0%/);
  assert.doesNotMatch(svg, /987654321|123456|private-user|<script>|TRY|USD|₺|\$/);
  const many = renderPortfolioShareSvg(Array.from({ length: 25 }, (_, i) => ({ label: `SYM${i}`, percent: 4 })));
  assert.ok(many.height > 1350);
  assert.match(many.svg, /SYM24/);
  assert.deepEqual(getShareAllocation([]), []);
  const tiny = getShareAllocation([{ name: 'BIG', percent: 99.99 }, { name: 'TINY', percent: 0.01 }]);
  assert.match(renderPortfolioShareSvg(tiny).svg, /TINY/);
});

test('reordering uses the latest records without losing quotes or changing the original array', () => {
  const a = { id: 'a', currentPrice: 400, notes: 'keep' };
  const b = { id: 'b', currentPrice: 600 };
  const c = { id: 'c', currentPrice: 800 };
  const stocks = [a, b, c];
  assert.deepEqual(movePortfolioStock(stocks, 'a', 'c'), [b, c, a]);
  assert.deepEqual(movePortfolioStock(stocks, 'c', 'a'), [c, a, b]);
  assert.deepEqual(stocks, [a, b, c]);
  assert.equal(movePortfolioStock(stocks, 'missing', 'a'), stocks);
  assert.equal(movePortfolioStock(stocks, 'a', 'a'), stocks);
});

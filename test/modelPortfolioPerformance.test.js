import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_PORTFOLIO_BENCHMARKS,
  buildModelPortfolioChartData,
  calculateModelPortfolioSnapshot,
  toModelPortfolioMarketSymbol,
} from '../src/utils/modelPortfolioPerformance.js';

function portfolio(overrides = {}) {
  return {
    slug: 'balanced-growth',
    versionKey: 'balanced-growth--2026-09-01',
    cashWeightPct: 10,
    tracking: {
      baseFxByCurrency: { USD: 30 },
      benchmarkBaselines: {},
    },
    holdings: [],
    ...overrides,
  };
}

test('benchmark tanımları ve BIST sembol dönüşümü sabittir', () => {
  assert.deepEqual(MODEL_PORTFOLIO_BENCHMARKS, [
    { key: 'bist100', label: 'BIST 100', symbol: 'XU100.IS', currency: 'TRY' },
    { key: 'sp500', label: 'S&P 500', symbol: '^GSPC', currency: 'USD' },
    { key: 'nasdaq', label: 'NASDAQ', symbol: '^IXIC', currency: 'USD' },
    { key: 'gold', label: 'Altın', symbol: 'GC=F', currency: 'USD' },
  ]);
  assert.equal(toModelPortfolioMarketSymbol({ ticker: 'thyao', market: 'BIST' }), 'THYAO.IS');
  assert.equal(toModelPortfolioMarketSymbol({ ticker: 'THYAO.IS', market: 'BIST' }), 'THYAO.IS');
  assert.equal(toModelPortfolioMarketSymbol({ ticker: 'aapl', market: 'NASDAQ' }), 'AAPL');
  assert.equal(
    toModelPortfolioMarketSymbol({ ticker: 'ABC', market: 'NASDAQ', sourceSymbol: 'ABC.IS' }),
    'ABC.IS'
  );
});

test('TRY, USD ve nakdi sabit başlangıç ağırlıklarıyla TL NAV içinde birleştirir', () => {
  const result = calculateModelPortfolioSnapshot(
    portfolio({
      holdings: [
        { ticker: 'THYAO', market: 'BIST', currency: 'TRY', weightPct: 45, currentPriceAtGeneration: 100 },
        { ticker: 'AAPL', market: 'NASDAQ', currency: 'USD', weightPct: 45, currentPriceAtGeneration: 50 },
      ],
    }),
    {
      priceBySymbol: { 'THYAO.IS': 110, AAPL: 55 },
      fxByCurrency: { USD: 33 },
    }
  );

  // 10 nakit + 45*1,10 + 45*1,10*1,10 = 113,95
  assert.equal(result.navValue, 113.95);
  assert.equal(result.returnPct, 13.95);
  assert.equal(result.coveragePct, 100);
});

test('fiyat sabitken yalnızca kur hareketini USD holding getirisine yansıtır', () => {
  const result = calculateModelPortfolioSnapshot(
    portfolio({
      cashWeightPct: 0,
      holdings: [
        { ticker: 'MSFT', market: 'NASDAQ', currency: 'USD', weightPct: 100, currentPriceAtGeneration: 200 },
      ],
    }),
    { priceBySymbol: { MSFT: 200 }, fxByCurrency: { USD: 33 } }
  );

  assert.equal(result.navValue, 110);
  assert.equal(result.returnPct, 10);
  assert.equal(result.coveragePct, 100);
});

test('hisse bölünmesini fiyat kaybı sanmadan pay adedi çarpanıyla düzeltir', () => {
  const portfolio = {
    cashWeightPct: 0,
    tracking: { baseFxByCurrency: { TRY: 1 } },
    holdings: [
      {
        ticker: 'SPLT',
        market: 'NASDAQ',
        currency: 'TRY',
        weightPct: 100,
        currentPriceAtGeneration: 100,
      },
    ],
  };

  const snapshot = calculateModelPortfolioSnapshot(portfolio, {
    priceBySymbol: { SPLT: 52 },
    fxByCurrency: { TRY: 1 },
    splitFactorBySymbol: { SPLT: 2 },
  });

  assert.equal(snapshot.navValue, 104);
  assert.equal(snapshot.returnPct, 4);
});

test('eksik fiyatı baz değerde tutar ve coverage oranını yatırım ağırlığından hesaplar', () => {
  const result = calculateModelPortfolioSnapshot(
    portfolio({
      cashWeightPct: 20,
      holdings: [
        { ticker: 'GARAN', market: 'BIST', currency: 'TRY', weightPct: 40, currentPriceAtGeneration: 100 },
        { ticker: 'NVDA', market: 'NASDAQ', currency: 'USD', weightPct: 40, currentPriceAtGeneration: 100 },
      ],
    }),
    {
      priceBySymbol: { 'GARAN.IS': 120 },
      fxByCurrency: { USD: 33 },
    }
  );

  // NVDA eksik olduğu için 40 baz değerinde kalır: 20 + 48 + 40 = 108.
  assert.equal(result.navValue, 108);
  assert.equal(result.returnPct, 8);
  assert.equal(result.coveragePct, 50);
});

test('benchmark getirilerini fiyat ve kurla TL bazında normalize eder', () => {
  const result = calculateModelPortfolioSnapshot(
    portfolio({
      cashWeightPct: 100,
      tracking: {
        baseFxByCurrency: { USD: 30 },
        benchmarkBaselines: {
          bist100: { price: 10_000, currency: 'TRY' },
          sp500: { price: 5_000, currency: 'USD' },
          nasdaq: { price: 18_000, currency: 'USD' },
        },
      },
    }),
    {
      fxByCurrency: { USD: 33 },
      benchmarkPriceByKey: {
        bist100: 11_000,
        sp500: 5_500,
        nasdaq: 0,
      },
    }
  );

  assert.equal(result.benchmarks.bist100, 10);
  assert.equal(result.benchmarks.sp500, 21);
  assert.equal(result.benchmarks.nasdaq, null);
  assert.equal(result.benchmarks.gold, null);
});

test('aktif sürüm satırlarını tarihte birleştirir, yuvarlar ve kronolojik sıralar', () => {
  const portfolios = [
    { slug: 'quality-defense', versionKey: 'quality-v2' },
    { slug: 'balanced-growth', versionKey: 'balanced-v2' },
  ];
  const rows = [
    {
      version_key: 'quality-v2',
      nav_date: '2026-09-02',
      return_pct: 2.345,
      benchmarks: { bist100: 1.116, sp500: 2 },
    },
    {
      version_key: 'balanced-v2',
      nav_date: '2026-09-01',
      return_pct: -1.234,
      benchmarks: { sp500: 0.5 },
    },
    {
      version_key: 'quality-v2',
      nav_date: '2026-09-01T18:00:00.000Z',
      return_pct: 1.004,
      benchmarks: { bist100: 0.25, nasdaq: '0.336' },
    },
    {
      version_key: 'balanced-v2',
      nav_date: '2026-09-02',
      return_pct: 1.876,
      benchmarks: { gold: -0.444 },
    },
    {
      version_key: 'quality-v1',
      nav_date: '2026-08-31',
      return_pct: 99,
      benchmarks: { bist100: 99 },
    },
  ];

  assert.deepEqual(buildModelPortfolioChartData(portfolios, rows), [
    {
      date: '2026-09-01',
      'balanced-growth': -1.23,
      sp500: 0.5,
      'quality-defense': 1,
      bist100: 0.25,
      nasdaq: 0.34,
    },
    {
      date: '2026-09-02',
      'quality-defense': 2.35,
      bist100: 1.12,
      sp500: 2,
      'balanced-growth': 1.88,
      gold: -0.44,
    },
  ]);
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModelPortfolioPerformanceChart, {
  buildContinuousPerformanceData,
  buildPerformanceDetails,
  filterPerformanceRange,
  rebasePerformanceWindow,
} from './ModelPortfolioPerformanceChart.jsx';

const portfolios = [
  {
    slug: 'quality-defense',
    shortName: 'Koruma',
    versionKey: 'quality-defense--2026-09-16',
  },
  {
    slug: 'balanced-growth',
    shortName: 'Büyüme',
    versionKey: 'balanced-growth--2026-09-16',
  },
];

test('gerçek kapanış noktaları yetersizken dürüst takip başlangıcı durumunu gösterir', () => {
  render(
    <ModelPortfolioPerformanceChart
      portfolios={portfolios}
      navRows={[]}
      activeSlug="quality-defense"
      trackingStarted
    />
  );

  expect(screen.getByText('Takip başladı; ilk kapanış verisi bekleniyor.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /BIST 100/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /S&P 500/ })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: /NASDAQ/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Altın/ })).toBeInTheDocument();
});

test('benchmark karşılaştırmaları bağımsız açılıp kapatılır', async () => {
  const user = userEvent.setup();
  render(
    <ModelPortfolioPerformanceChart
      portfolios={portfolios}
      navRows={[]}
      activeSlug="quality-defense"
      trackingStarted
    />
  );

  const sp500 = screen.getByRole('button', { name: /S&P 500/ });
  await user.click(sp500);
  expect(sp500).toHaveAttribute('aria-pressed', 'true');

  const bist100 = screen.getByRole('button', { name: /BIST 100/ });
  await user.click(bist100);
  expect(bist100).toHaveAttribute('aria-pressed', 'false');
});

test('tarihçe yüklenirken ve okunamadığında doğru boş durumunu gösterir', () => {
  const { rerender } = render(
    <ModelPortfolioPerformanceChart
      portfolios={portfolios}
      navRows={[]}
      activeSlug="quality-defense"
      trackingLoading
    />
  );
  expect(screen.getByText('Performans geçmişi yükleniyor…')).toBeInTheDocument();
  expect(screen.queryByText('Performans takibi henüz başlamadı.')).not.toBeInTheDocument();

  rerender(
    <ModelPortfolioPerformanceChart
      portfolios={portfolios}
      navRows={[]}
      activeSlug="quality-defense"
      trackingError="NAV geçmişi okunamadı."
    />
  );
  expect(screen.getByText('Performans geçmişi şu an okunamadı.')).toBeInTheDocument();
  expect(screen.queryByText('Performans takibi henüz başlamadı.')).not.toBeInTheDocument();
});

test('aylık sürümleri bileşik olarak zincirler ve benchmark tekrarlarını tek döngü sayar', () => {
  const versions = [
    {
      versionKey: 'quality-defense--2026-07-01',
      slug: 'quality-defense',
      cycleStart: '2026-07-01T12:00:00.000Z',
    },
    {
      versionKey: 'quality-defense--2026-08-01',
      slug: 'quality-defense',
      cycleStart: '2026-08-01T12:00:00.000Z',
    },
    {
      versionKey: 'balanced-growth--2026-08-01',
      slug: 'balanced-growth',
      cycleStart: '2026-08-01T12:00:00.000Z',
    },
  ];
  const rows = [
    {
      version_key: 'quality-defense--2026-07-01',
      nav_date: '2026-07-01',
      return_pct: 0,
      benchmarks: { bist100: 0 },
    },
    {
      version_key: 'quality-defense--2026-07-01',
      nav_date: '2026-07-31',
      return_pct: 10,
      benchmarks: { bist100: 2 },
    },
    {
      version_key: 'quality-defense--2026-08-01',
      nav_date: '2026-08-01',
      return_pct: 0,
      benchmarks: { bist100: 0 },
    },
    {
      version_key: 'quality-defense--2026-08-01',
      nav_date: '2026-08-31',
      return_pct: 5,
      benchmarks: { bist100: 3 },
    },
    // Aynı benchmark döngüsünün ikinci portföydeki kopyası bileşiğe yeniden eklenmemeli.
    {
      version_key: 'balanced-growth--2026-08-01',
      nav_date: '2026-08-31',
      return_pct: 4,
      benchmarks: { bist100: 3 },
    },
  ];

  const result = buildContinuousPerformanceData(portfolios, rows, versions);
  expect(result.versionCounts['quality-defense']).toBe(2);
  expect(result.versionCounts.bist100).toBe(2);
  expect(result.startDates['quality-defense']).toBe('2026-07-01');
  expect(result.startDates['balanced-growth']).toBe('2026-08-01');
  expect(result.data.find((row) => row.date === '2026-07-31')['quality-defense']).toBeCloseTo(10);
  expect(result.data.find((row) => row.date === '2026-08-01')['quality-defense']).toBeCloseTo(10);
  expect(result.data.find((row) => row.date === '2026-08-31')['quality-defense']).toBeCloseTo(15.5);
  expect(result.data.find((row) => row.date === '2026-08-31').bist100).toBeCloseTo(5.06);
});

test('aynı döngüdeki benchmark kopyalarından en yeni gözlemi seçer', () => {
  const versions = portfolios.map((portfolio) => ({
    versionKey: portfolio.versionKey,
    slug: portfolio.slug,
    cycleStart: '2026-09-16T09:00:00.000Z',
  }));
  const result = buildContinuousPerformanceData(
    portfolios,
    [
      {
        version_key: 'balanced-growth--2026-09-16',
        nav_date: '2026-09-17',
        observed_at: '2026-09-17T12:00:00.000Z',
        return_pct: 1,
        benchmarks: { bist100: 3 },
      },
      {
        version_key: 'quality-defense--2026-09-16',
        nav_date: '2026-09-17',
        observed_at: '2026-09-17T10:00:00.000Z',
        return_pct: 2,
        benchmarks: { bist100: 1 },
      },
    ],
    versions
  );

  expect(result.data.find((row) => row.date === '2026-09-17').bist100).toBe(3);
});

test('tarih aralığını son gerçek noktaya göre filtreler ve gerçek kesim değerine normalize eder', () => {
  const data = [
    { date: '2026-07-01', portfolio: 0, yeni: undefined },
    { date: '2026-07-31', portfolio: 10 },
    { date: '2026-08-01', portfolio: 10, yeni: 4 },
    { date: '2026-08-31', portfolio: 15.5, yeni: 8 },
  ];

  const filtered = filterPerformanceRange(data, '1m', { portfolio: 2, yeni: 1 });
  expect(filtered.map((row) => row.date)).toEqual([
    '2026-07-31',
    '2026-08-01',
    '2026-08-31',
  ]);
  expect(filtered[0].portfolio).toBe(0);
  expect(filtered[2].portfolio).toBeCloseTo(5);
  // Kesim tarihinden sonra başlayan seri, kısmi başlangıç getirisi diğer
  // serilerin 1 aylık getirisiyle karışmasın diye bu aralıkta gösterilmez.
  expect(filtered[1].yeni).toBeNull();
  expect(filtered[2].yeni).toBeNull();

  const singleVersion = filterPerformanceRange(data, '1m', { portfolio: 1 });
  expect(singleVersion[0].portfolio).toBe(0);
  expect(singleVersion[2].portfolio).toBeCloseTo(5);
});

test('MAKS görünümünü serilerin ilk ortak gerçek gününe yeniden bazlar', () => {
  const rebased = rebasePerformanceWindow(
    [
      { date: '2026-01-01', eski: 0 },
      { date: '2026-02-01', eski: 10, yeni: 0, bist100: 5 },
      { date: '2026-03-01', eski: 21, yeni: 20, bist100: 15.5, gec: 7 },
    ],
    '2026-02-01'
  );

  expect(rebased.map((row) => row.date)).toEqual(['2026-02-01', '2026-03-01']);
  expect(rebased[0]).toMatchObject({ eski: 0, yeni: 0, bist100: 0 });
  expect(rebased[1].eski).toBeCloseTo(10);
  expect(rebased[1].yeni).toBeCloseTo(20);
  expect(rebased[1].bist100).toBeCloseTo(10);
  expect(rebased[1].gec).toBeNull();
});

test('performans detaylarını gerçek karşılaştırma noktalarından hesaplar ve yetersiz geçmişi boş bırakır', () => {
  const data = [
    { date: '2025-09-15', 'quality-defense': 0 },
    { date: '2026-03-15', 'quality-defense': 10 },
    { date: '2026-06-15', 'quality-defense': 21 },
    { date: '2026-08-15', 'quality-defense': 33.1 },
    { date: '2026-09-08', 'quality-defense': 40 },
    { date: '2026-09-14', 'quality-defense': 41.4 },
    { date: '2026-09-15', 'quality-defense': 42.814, 'balanced-growth': 5 },
  ];

  const details = buildPerformanceDetails(
    portfolios.map((portfolio, index) => ({ ...portfolio, riskTier: index + 1, riskScore: 24 + index * 20 })),
    data,
    { 'quality-defense': '2025-09-01T12:00:00.000Z' }
  );
  const quality = details.find((item) => item.slug === 'quality-defense');
  expect(quality.startDate).toBe('2025-09-01');
  expect(quality.latestNav).toBeCloseTo(142.814);
  expect(quality.daily).toBeCloseTo(1);
  expect(quality.weekly).toBeCloseTo(2.01);
  expect(quality.month1).toBeCloseTo(7.298, 2);
  expect(quality.month3).toBeCloseTo(18.028, 2);
  expect(quality.month6).toBeCloseTo(29.831, 2);
  expect(quality.year1).toBeCloseTo(42.814);
  expect(quality.total).toBeCloseTo(42.814);

  const growth = details.find((item) => item.slug === 'balanced-growth');
  expect(growth.latestNav).toBe(105);
  expect(growth.daily).toBeNull();
  expect(growth.weekly).toBeNull();
  expect(growth.month1).toBeNull();
  expect(growth.year1).toBeNull();
  expect(growth.total).toBe(5);
});

test('ekranda aralık kontrolleri ve performans detay tablosu bulunur', () => {
  render(
    <ModelPortfolioPerformanceChart
      portfolios={portfolios}
      navRows={[]}
      activeSlug="quality-defense"
      trackingStarted
    />
  );

  expect(screen.getByRole('group', { name: 'Performans aralığı' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '6A' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '1Y' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'MAKS' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('heading', { name: 'Performans Detayları' })).toBeInTheDocument();
  expect(screen.getAllByText(/TL bazlı fiyat getirisi, temettü hariç/)).toHaveLength(2);
  expect(screen.getByRole('searchbox', { name: 'Portföy ara' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Takip Başından' })).toBeInTheDocument();
});

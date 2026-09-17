import { render, screen } from '@testing-library/react';
import { ModelPortfolioHistory } from './ModelPortfoliosPage.jsx';

test('dönem arşivi portföyü dört TL benchmarkıyla birlikte gösterir', () => {
  render(
    <ModelPortfolioHistory
      slug="quality-defense"
      versions={[
        {
          versionKey: 'quality-defense--2026-09-01',
          slug: 'quality-defense',
          cycleStart: '2026-09-01T09:00:00.000Z',
          cycleEnd: '2026-10-01T09:00:00.000Z',
          status: 'completed',
        },
      ]}
      navRows={[
        {
          version_key: 'quality-defense--2026-09-01',
          nav_date: '2026-10-01',
          observed_at: '2026-10-01T09:00:00.000Z',
          return_pct: 4.5,
          benchmarks: {
            sp500: 1.1,
            nasdaq: 2.2,
            gold: -0.5,
            bist100: 3.3,
          },
        },
      ]}
    />
  );

  expect(screen.getByRole('columnheader', { name: 'S&P 500 (TL)' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'NASDAQ (TL)' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Altın (TL)' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'BIST 100 (TL)' })).toBeInTheDocument();
  expect(screen.getByText('+4.50%')).toBeInTheDocument();
  expect(screen.getByText('-0.50%')).toBeInTheDocument();
});

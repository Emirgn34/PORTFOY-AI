import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import AnalysisCard from './AnalysisCard.jsx';

const STOCK = { id: '1', ticker: 'AAPL', company: 'Apple Inc.' };

const FULL_ANALYSIS = {
  overallScore: 66,
  riskScore: 42,
  returnPotential: 60,
  newsSensitivity: 55,
  reliableNewsAvg: 5.5,
  recommendation: 'Nötr',
  comment: 'Dengeli görünüm.',
};

describe('AnalysisCard', () => {
  // REGRESYON: production'da mock fallback kapalı olduğu için analiz üretildikten
  // SONRA portföye eklenen hisseler analysis=null ile gelir. Eskiden bu prop
  // korumasız okunuyordu (analysis.recommendation) ve tüm sayfa çöküyordu.
  it('analizi olmayan hisse için çökmeden "bekliyor" kartı çizer', () => {
    expect(() =>
      render(<AnalysisCard stock={STOCK} analysis={null} weightPercent={12.3} />)
    ).not.toThrow();

    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText(/12\.3%/)).toBeInTheDocument();
    expect(screen.getByText(/son analiz üretildikten sonra portföye eklenmiş/i)).toBeInTheDocument();
  });

  it('analiz varsa skorları ve öneriyi gösterir', () => {
    render(<AnalysisCard stock={STOCK} analysis={FULL_ANALYSIS} weightPercent={38.7} />);

    expect(screen.getByText('66')).toBeInTheDocument();
    expect(screen.getByText('Nötr')).toBeInTheDocument();
    expect(screen.getByText('Dengeli görünüm.')).toBeInTheDocument();
    expect(screen.getByText(/38\.7%/)).toBeInTheDocument();
  });

  it('bilinmeyen öneri etiketinde de çökmez', () => {
    expect(() =>
      render(
        <AnalysisCard
          stock={STOCK}
          analysis={{ ...FULL_ANALYSIS, recommendation: 'Bilinmeyen' }}
          weightPercent={1}
        />
      )
    ).not.toThrow();
  });
});

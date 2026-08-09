import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Sayfa; portföyü buluttan, analizi de kayıtlı satırdan okur. Testte ikisini de
// biz besliyoruz ki canlıdaki senaryo birebir kurulabilsin.
const syncedState = vi.hoisted(() => ({ stocks: [], loading: false }));
const services = vi.hoisted(() => ({ cached: null }));

vi.mock('../hooks/useSyncedState.js', () => ({
  default: () => [syncedState.stocks, vi.fn(), { loading: syncedState.loading, cloud: true }],
}));

vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ configured: true, isAuthenticated: true, user: { id: 'u1' } }),
}));

vi.mock('../services/analysis.js', () => ({
  loadCachedAnalysis: () => Promise.resolve(services.cached),
  runAnalysis: vi.fn(),
}));

// Testler PRODUCTION davranışını doğrular: demo veri fallback'i kapalı.
// Sayfayı çökerten yol tam olarak buydu.
vi.mock('../config.js', () => ({ MOCK_ENABLED: false }));

const { default: AnalysisPage } = await import('./AnalysisPage.jsx');

const STOCKS = [
  { id: '1', ticker: 'THYAO', company: 'Türk Hava Yolları', market: 'BIST', quantity: 10, avgPrice: 100, currentPrice: 120, currency: 'TRY' },
  { id: '2', ticker: 'AAPL', company: 'Apple Inc.', market: 'US', quantity: 5, avgPrice: 200, currentPrice: 220, currency: 'USD' },
];

// Yalnızca THYAO analiz edilmiş; AAPL analizden SONRA eklenmiş.
const STALE_ANALYSIS = {
  generatedAt: '2026-08-09T10:00:00.000Z',
  portfolio: {
    overallScore: 70,
    riskLevel: 'Orta',
    diversificationScore: 60,
    newsImpactScore: 70,
    fundamentalScore: 70,
    technicalScore: 60,
    comment: 'Portföy yorumu.',
  },
  stocks: {
    THYAO: {
      overallScore: 78,
      riskScore: 55,
      returnPotential: 76,
      newsSensitivity: 68,
      reliableNewsAvg: 8.6,
      recommendation: 'Güçlü',
      comment: 'THYAO yorumu.',
    },
  },
};

beforeEach(() => {
  syncedState.stocks = STOCKS;
  syncedState.loading = false;
  services.cached = null;
});

describe('AnalysisPage', () => {
  it('portföy buluttan gelene kadar demo hisse göstermez', () => {
    syncedState.loading = true;
    render(<AnalysisPage />);

    expect(screen.queryByText('THYAO')).not.toBeInTheDocument();
    expect(screen.queryByText('AAPL')).not.toBeInTheDocument();
  });

  // REGRESYON: kayıtlı analizde olmayan bir hisse (analizden sonra eklenen)
  // sayfanın tamamını çökertiyordu — kullanıcı "sayfaya giremiyorum" diyordu.
  it('analizden sonra eklenen hisse sayfayı çökertmez, uyarı gösterir', async () => {
    services.cached = STALE_ANALYSIS;
    render(<AnalysisPage />);

    // Analizi olan hisse skorlarıyla çizilir
    await waitFor(() => expect(screen.getByText('THYAO yorumu.')).toBeInTheDocument());

    // Analizi olmayan hisse çökmeden "bekliyor" kartıyla çizilir
    // (AAPL hem kartta hem uyarı şeridinde geçtiği için birden fazla eşleşme olur)
    expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0);
    expect(screen.getByText(/son analiz üretildikten sonra portföye eklenmiş/i)).toBeInTheDocument();

    // Ve kullanıcı neden eksik olduğunu görür
    expect(screen.getByText(/Portföyün son analizden sonra değişmiş/i)).toBeInTheDocument();
  });

  it('kayıtlı analiz yokken production skor uydurmaz', async () => {
    render(<AnalysisPage />);

    await waitFor(() =>
      expect(screen.getByText(/Henüz gerçek analiz oluşturulmadı/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/Henüz hisse analizi oluşturulmadı/i)).toBeInTheDocument();
    // Mock skorlar (72/100 vb.) production'da sızmamalı
    expect(screen.queryByText('72')).not.toBeInTheDocument();
  });

  // AI atlandığında sebebi eskiden yalnızca sunucu log'una yazılıyordu;
  // kullanıcı "yorumlar neden otomatik?" sorusunu hiçbir yerde göremiyordu.
  it('AI atlandıysa sebebini kullanıcıya gösterir', async () => {
    services.cached = {
      ...STALE_ANALYSIS,
      stocks: { ...STALE_ANALYSIS.stocks, AAPL: { ...STALE_ANALYSIS.stocks.THYAO, comment: 'AAPL yorumu.' } },
      aiNotice: {
        code: 'setup_missing',
        message: 'AI kota tablosu kurulu değil — yorumlar AI olmadan üretildi.',
      },
    };
    render(<AnalysisPage />);

    await waitFor(() =>
      expect(screen.getByText(/AI kota tablosu kurulu değil/i)).toBeInTheDocument()
    );
  });

  it('portföy boşken analiz düğmesi pasiftir', async () => {
    syncedState.stocks = [];
    render(<AnalysisPage />);

    const button = await screen.findByRole('button', { name: /Portföyümü Analiz Et/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Analiz edilecek hisse yok/i)).toBeInTheDocument();
  });
});

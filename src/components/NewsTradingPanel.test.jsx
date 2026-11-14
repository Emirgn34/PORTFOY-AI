import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import NewsTradingPanel from './NewsTradingPanel.jsx';
import { newsRequest } from '../services/news.js';

vi.mock('../services/news.js', () => ({ newsRequest: vi.fn() }));
function result(bias = 'positive', summary = 'Haber özeti') {
  return { articles: [{ id: 'a' }], warnings: [], analysis: { summary, bias, condition: bias === 'positive' ? 'Önce teyit gerekli.' : 'Yeni tahsis %0.',
    evidence: [{ id: 'a', title: 'Company raises guidance', publisher: 'Reuters', link: 'https://example.com/a', publishedAt: '2026-11-14T10:00:00Z' }],
    themes: [{ label: 'Bilanço', shortTerm: 'İlk seans fiyatlama', longTerm: 'Nakit akışı izlenir' }],
    priceContext: { available: true, price: 100, currency: 'USD', asOf: '2026-11-13T21:00:00Z', sampleSessions: 60, illustrativeStop: 98,
      method: 'Tarihsel senaryo; fiyat hedefi değildir.', ranges: [{ horizon: '5 işlem günü', sessions: 5, low: 95, high: 105, downsidePercent: -5, upsidePercent: 5 }] } } };
}
beforeEach(() => vi.clearAllMocks());

test('şirket haberleri ve kaynakları normal akışa aktarılır, kullanıcı sermayesiyle risk/tahsis hesaplanır', async () => {
  const onArticles = vi.fn(); newsRequest.mockResolvedValue(result());
  render(<NewsTradingPanel initialSymbol="AAPL" onArticles={onArticles} />);
  fireEvent.click(screen.getByRole('button', { name: 'Haberleri işlemlere dönüştür' }));
  await screen.findByText('Haber özeti');
  expect(newsRequest).toHaveBeenCalledWith('implications', expect.objectContaining({ symbol: 'AAPL' }));
  expect(onArticles).toHaveBeenCalledWith([{ id: 'a' }]);
  expect(screen.getByRole('link', { name: 'Company raises guidance' })).toHaveAttribute('href', 'https://example.com/a');
  expect(screen.getByText(/Nakit akışı izlenir/)).toHaveTextContent('Uzun vade');
  expect(screen.getByLabelText('Sermaye')).toHaveValue(null);
  fireEvent.change(screen.getByLabelText('Sermaye'), { target: { value: '10000' } });
  expect(screen.getByRole('status')).toHaveTextContent('4 adet');
  expect(screen.getByRole('status')).toHaveTextContent('8,8 USD');
  fireEvent.change(screen.getByLabelText('Zarar kes'), { target: { value: '101' } });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('olumsuz haberde hesaplanan örnek limite rağmen yeni uzun pozisyon sıfırdır', async () => {
  newsRequest.mockResolvedValue(result('negative'));
  render(<NewsTradingPanel initialSymbol="AAPL" autoLoad />);
  await screen.findByText('Haber özeti');
  fireEvent.change(screen.getByLabelText('Sermaye'), { target: { value: '10000' } });
  expect(screen.getByRole('status')).toHaveTextContent('değerlendirilebilecek adet: 0');
});

test('sembol değişince önceki analiz ve bekleyen yanıt yeni şirkete taşınmaz', async () => {
  let resolveApple;
  newsRequest.mockImplementation((_, { symbol }) => symbol === 'AAPL' ? new Promise((resolve) => { resolveApple = resolve; }) : Promise.resolve(result('positive', 'Microsoft haberi')));
  const view = render(<NewsTradingPanel initialSymbol="AAPL" autoLoad />);
  view.rerender(<NewsTradingPanel initialSymbol="MSFT" autoLoad />);
  await screen.findByText('Microsoft haberi');
  await act(async () => resolveApple(result('positive', 'Eski Apple yanıtı')));
  expect(screen.queryByText('Eski Apple yanıtı')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Analiz hisse kodu')).toHaveValue('MSFT');
});

test('sektör sorgusunda sayısal fiyat uydurulmaz; hata yeniden denemeye izin verir', async () => {
  newsRequest.mockRejectedValueOnce(new Error('Kaynak yanıt vermiyor.'));
  render(<NewsTradingPanel />);
  fireEvent.change(screen.getByLabelText('Analiz edilecek şirket veya sektör'), { target: { value: 'bankacılık' } });
  fireEvent.click(screen.getByRole('button', { name: 'Haberleri işlemlere dönüştür' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Kaynak yanıt vermiyor.');
  newsRequest.mockResolvedValueOnce({ articles: [], analysis: { summary: 'Sektör özeti', evidence: [], themes: [], bias: 'neutral', condition: 'Teyit bekle',
    priceContext: { available: false, reason: 'Fiyat için hisse seçin.' } } });
  fireEvent.click(screen.getByRole('button', { name: 'Haberleri işlemlere dönüştür' }));
  await waitFor(() => expect(screen.getByText('Fiyat için hisse seçin.')).toBeInTheDocument());
  expect(screen.queryByLabelText('Sermaye')).not.toBeInTheDocument();
});

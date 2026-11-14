import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import NewsPage from './NewsPage.jsx';
import { fetchAllLiveNews, fetchLiveNews } from '../services/liveData.js';

const store = vi.hoisted(() => ({ loading: false, stocks: [{ ticker: 'AAPL', company: 'Apple', market: 'ABD' }], watch: [] }));
vi.mock('../hooks/useSyncedState.js', () => ({ default: ({ table }) => [table === 'portfolios' ? store.stocks : store.watch, vi.fn(), { loading: store.loading }] }));
vi.mock('../hooks/useMockModule.js', () => ({ default: () => null }));
vi.mock('../components/CatalystNewsPanel.jsx', () => ({ default: () => <p>Hızlı haberler</p> }));
vi.mock('../components/NewsTradingPanel.jsx', () => ({ default: ({ onArticles }) => <button onClick={() => onArticles?.([article('analysis', 'Analizden gelen yeni haber')])}>Analiz haberlerini ekle</button> }));
vi.mock('../services/liveData.js', async (importOriginal) => ({ ...await importOriginal(), fetchAllLiveNews: vi.fn(), fetchLiveNews: vi.fn(), searchSymbols: vi.fn().mockResolvedValue([]) }));

function article(id = 'a', title = 'Apple şirket gündemi', symbol = 'AAPL') {
  return { id, symbol, title, publisher: 'Reuters', publishedAt: '2026-11-14T10:00:00Z', link: 'https://example.com/a', sentiment: 'neutral' };
}
function page() { return render(<MemoryRouter><NewsPage /></MemoryRouter>); }
beforeEach(() => { vi.clearAllMocks(); store.loading = false; fetchAllLiveNews.mockResolvedValue([]); fetchLiveNews.mockResolvedValue([]); });

test('global havuz boş dizi döndürse de portföyün normal haberleri görünür', async () => {
  fetchLiveNews.mockResolvedValue([article()]); page();
  expect((await screen.findAllByText('Apple şirket gündemi')).length).toBeGreaterThan(0);
  expect(fetchLiveNews).toHaveBeenCalledWith(store.stocks, { limit: 300 });
  expect(screen.getByRole('tab', { name: 'Tüm Haberler' })).toHaveAttribute('aria-selected', 'true');
});

test('portföy bulut okuması beklerken genel normal haber akışı engellenmez', async () => {
  store.loading = true; fetchAllLiveNews.mockResolvedValue([article()]); page();
  expect((await screen.findAllByText('Apple şirket gündemi')).length).toBeGreaterThan(0);
  expect(fetchLiveNews).not.toHaveBeenCalled();
});

test('bağlantı boşken açık hata ve yenileme vardır; başarılı yeniden deneme haberleri getirir', async () => {
  page(); await screen.findByText(/Normal haber akışı şu an boş/);
  fetchAllLiveNews.mockResolvedValue([article()]);
  fireEvent.click(screen.getByRole('button', { name: 'Haberleri yenile' }));
  expect((await screen.findAllByText('Apple şirket gündemi')).length).toBeGreaterThan(0);
});

test('haber analizinden gelen kaynak makaleler normal haber listesine eklenir', async () => {
  page(); await waitFor(() => expect(screen.getByRole('button', { name: 'Haberleri yenile' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Analiz haberlerini ekle' }));
  expect(screen.getAllByText('Analizden gelen yeni haber').length).toBeGreaterThan(0);
});

test('arşiv sekmesindeyken daraltılan filtre yeniden en yeni sekmesini gösterir', async () => {
  fetchAllLiveNews.mockResolvedValue([article('1', 'Apple 1'), article('2', 'Microsoft', 'MSFT'), article('3', 'Nvidia', 'NVDA')]);
  page(); await screen.findByText('Toplam 3 haber — bu sekmede 1 haber gösteriliyor. Yeni haberler geldikçe eskiler sonraki sekmelere kayar.');
  fireEvent.click(screen.getByRole('button', { name: /Arşiv \(En Eski\)/ }));
  fireEvent.change(screen.getByPlaceholderText('Haber metni ara...'), { target: { value: 'Apple 1' } });
  await waitFor(() => expect(screen.getByText(/Toplam 1 haber/)).toHaveTextContent('bu sekmede 1 haber'));
});

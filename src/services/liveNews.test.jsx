import { vi } from 'vitest';
import { fetchLiveNews, mapLiveArticleToNews } from './liveData.js';
import { newsRequest } from './news.js';

vi.mock('./news.js', () => ({ newsRequest: vi.fn() }));
vi.mock('./supabaseClient.js', () => ({ supabase: null, HAS_SUPABASE: false, SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }));
beforeEach(() => vi.clearAllMocks());

test('arşiv boş olsa da portföyün beşinci ve sonraki sembolleri ayrı sınırlı isteklerle kapsanır', async () => {
  newsRequest.mockImplementation(async (_, { symbols }) => ({ articles: symbols.map((symbol) => ({ id: symbol, symbol, title: symbol })) }));
  const stocks = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOG'].map((ticker) => ({ ticker, market: 'ABD' }));
  const articles = await fetchLiveNews(stocks);
  expect(newsRequest).toHaveBeenCalledTimes(2);
  expect(articles.map((a) => a.symbol)).toEqual(stocks.map((s) => s.ticker));
  expect(newsRequest.mock.calls.every(([, options]) => options.symbols.length <= 4)).toBe(true);
});

test('sektör makalesi ve eksik tarih güvenle eşlenir; güncel tarih veya hisse uydurulmaz', () => {
  const article = mapLiveArticleToNews({ title: 'Sektör haberi', publisher: 'Reuters', link: 'https://example.com/story', publishedAt: null });
  expect(article.ticker).toBe('SEKTÖR'); expect(article.market).toBeNull(); expect(article.date).toBeNull();
  expect(article.id).toBe('live-https://example.com/story');
});

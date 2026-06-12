import { useEffect, useMemo, useState } from 'react';
import { Search, SearchX, Radio } from 'lucide-react';
import { MOCK_NEWS, NEWS_TYPES } from '../data/mockNews.js';
import useLocalStorage from '../hooks/useLocalStorage.js';
import { SEED_STOCKS } from '../data/seedPortfolio.js';
import { SEED_WATCHLIST } from '../data/seedWatchlist.js';
import { fetchLiveNews, mapLiveArticleToNews } from '../services/liveData.js';
import NewsCard from '../components/NewsCard.jsx';
import NewsDetailModal from '../components/NewsDetailModal.jsx';

const SENTIMENT_OPTIONS = [
  { value: 'all', label: 'Tüm Duygular' },
  { value: 'positive', label: 'Pozitif' },
  { value: 'negative', label: 'Negatif' },
  { value: 'neutral', label: 'Nötr' },
];

/**
 * Haberler tarihe göre (yeniden eskiye) 3 sekmeye bölünür. Yeni haberler
 * geldikçe eskiler 2. ve 3. sekmeye kayar; böylece hiçbir haber gözden kaçmaz.
 */
const NEWS_TABS = [
  { index: 0, label: 'En Yeni' },
  { index: 1, label: 'Önceki Haberler' },
  { index: 2, label: 'Arşiv (En Eski)' },
];

const selectClass =
  'rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-accent';

export default function NewsPage() {
  const [tickerFilter, setTickerFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sentimentFilter, setSentimentFilter] = useState('all');
  const [minReliability, setMinReliability] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNews, setSelectedNews] = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  const [liveNews, setLiveNews] = useState([]);

  // Canlı haberler portföy + izleme listesindeki tüm hisseler için çekilir
  const [portfolioStocks] = useLocalStorage('portfoyai_stocks', SEED_STOCKS);
  const [watchlistItems] = useLocalStorage('portfoyai_watchlist', SEED_WATCHLIST);

  useEffect(() => {
    let cancelled = false;
    const allStocks = [...portfolioStocks, ...watchlistItems];
    const companyByTicker = new Map(allStocks.map((s) => [s.ticker, s.company]));

    async function load() {
      const articles = await fetchLiveNews(allStocks);
      if (cancelled || !articles) return;
      setLiveNews(articles.map((a) => mapLiveArticleToNews(a, companyByTicker)));
    }

    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // Stok listeleri sayfa açıkken değişmez varsayılır; ilk yükleme + interval yeterli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Canlı + mock haberler tek akışta birleştirilir
  const allNews = useMemo(() => [...liveNews, ...MOCK_NEWS], [liveNews]);

  const tickers = useMemo(
    () => [...new Set(allNews.map((n) => n.ticker))].sort(),
    [allNews]
  );

  const filteredNews = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return allNews.filter((news) => {
      if (tickerFilter !== 'all' && news.ticker !== tickerFilter) return false;
      if (typeFilter !== 'all' && news.type !== typeFilter) return false;
      if (sentimentFilter !== 'all' && news.sentiment !== sentimentFilter) return false;
      if (news.reliability < minReliability) return false;
      if (
        query &&
        ![news.title, news.summary, news.company, news.ticker]
          .join(' ')
          .toLowerCase()
          .includes(query)
      ) {
        return false;
      }
      return true;
    }).sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [allNews, tickerFilter, typeFilter, sentimentFilter, minReliability, searchQuery]);

  // Filtrelenmiş haberler 3 eşit parçaya bölünür: en yeniler 1. sekmede
  const newsPages = useMemo(() => {
    const chunkSize = Math.max(1, Math.ceil(filteredNews.length / 3));
    return [
      filteredNews.slice(0, chunkSize),
      filteredNews.slice(chunkSize, chunkSize * 2),
      filteredNews.slice(chunkSize * 2),
    ];
  }, [filteredNews]);

  const visibleNews = newsPages[activeTab] ?? [];

  return (
    <div className="space-y-5">
      {/* Filtre alanı */}
      <div className="rounded-xl border border-navy-700/60 bg-navy-900 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Haber ara..."
              className={`${selectClass} w-full pl-9`}
            />
          </div>

          <select
            value={tickerFilter}
            onChange={(e) => setTickerFilter(e.target.value)}
            className={selectClass}
          >
            <option value="all">Tüm Hisseler</option>
            {tickers.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className={selectClass}
          >
            <option value="all">Tüm Haber Tipleri</option>
            {NEWS_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <select
            value={sentimentFilter}
            onChange={(e) => setSentimentFilter(e.target.value)}
            className={selectClass}
          >
            {SENTIMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <select
            value={minReliability}
            onChange={(e) => setMinReliability(Number(e.target.value))}
            className={selectClass}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                Min. güvenilirlik: {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tarih sekmeleri: en yeni → en eski */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex overflow-hidden rounded-lg border border-navy-700">
          {NEWS_TABS.map((tab) => (
            <button
              key={tab.index}
              type="button"
              onClick={() => setActiveTab(tab.index)}
              className={`px-4 py-2 text-xs font-medium transition-colors ${
                activeTab === tab.index
                  ? 'bg-accent text-white'
                  : 'text-slate-400 hover:bg-navy-800 hover:text-slate-200'
              }`}
            >
              {tab.label}
              <span className="ml-1.5 rounded bg-black/20 px-1.5 py-0.5 text-[10px] tabular-nums">
                {newsPages[tab.index]?.length ?? 0}
              </span>
            </button>
          ))}
        </div>
        <p className="flex items-center gap-2 text-xs text-slate-500">
          {liveNews.length > 0 && (
            <span className="flex items-center gap-1 rounded bg-gain/10 px-1.5 py-0.5 text-[10px] font-semibold text-gain">
              <Radio size={10} />
              {liveNews.length} canlı haber
            </span>
          )}
          Toplam {filteredNews.length} haber — bu sekmede {visibleNews.length} haber gösteriliyor.
          Yeni haberler geldikçe eskiler sonraki sekmelere kayar.
        </p>
      </div>

      {/* Haber kartları */}
      {visibleNews.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-navy-700 bg-navy-900/50 py-16 text-center">
          <SearchX size={36} className="mb-3 text-slate-600" />
          <p className="font-medium text-slate-300">
            {filteredNews.length === 0
              ? 'Filtrelere uyan haber bulunamadı'
              : 'Bu sekmede gösterilecek haber yok'}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {filteredNews.length === 0
              ? 'Filtreleri değiştirmeyi deneyin.'
              : 'Daha yeni haberler için önceki sekmelere bakın.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleNews.map((news) => (
            <NewsCard key={news.id} news={news} onClick={setSelectedNews} />
          ))}
        </div>
      )}

      <NewsDetailModal news={selectedNews} onClose={() => setSelectedNews(null)} />
    </div>
  );
}

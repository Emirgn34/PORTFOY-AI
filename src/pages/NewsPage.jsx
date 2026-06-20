import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, SearchX, Radio, X, Flame } from 'lucide-react';
import { MOCK_NEWS, NEWS_TYPES } from '../data/mockNews.js';
import useSyncedState from '../hooks/useSyncedState.js';
import { SEED_STOCKS } from '../data/seedPortfolio.js';
import { SEED_WATCHLIST } from '../data/seedWatchlist.js';
import { fetchLiveNews, fetchAllLiveNews, mapLiveArticleToNews, searchSymbols } from '../services/liveData.js';
import { detectCatalyst } from '../utils/newsSignals.js';
import { withNewsImportance } from '../utils/newsImportance.js';
import NewsCard from '../components/NewsCard.jsx';
import NewsDetailModal from '../components/NewsDetailModal.jsx';

/** Haber kapsamı: hangi hisselerin haberleri gösterilsin? */
const SCOPE_OPTIONS = [
  { value: 'all', label: 'Tüm Hisseler' },
  { value: 'portfolio', label: 'Portföyümdeki Hisseler' },
  { value: 'watchlist', label: 'İzleme Listemdeki Hisseler' },
  { value: 'bist', label: 'BIST Haberleri' },
  { value: 'us', label: 'ABD Haberleri' },
];

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
  const [scope, setScope] = useState('all');
  const [tickerFilter, setTickerFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sentimentFilter, setSentimentFilter] = useState('all');
  const [minReliability, setMinReliability] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNews, setSelectedNews] = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  const [onlyImportant, setOnlyImportant] = useState(false);
  const [liveNews, setLiveNews] = useState([]);

  // Hisse arama önerisi (haber filtresi için)
  const [tickerQuery, setTickerQuery] = useState('');
  const [tickerSuggestions, setTickerSuggestions] = useState([]);
  const [showTickerSugg, setShowTickerSugg] = useState(false);
  const skipTickerSearchRef = useRef(false);

  // Canlı haberler portföy + izleme listesindeki tüm hisseler için çekilir.
  // Veriler hesaba bağlı buluttan okunur (read-only); yüklenene kadar haber
  // çekme beklenir ki kullanıcının GERÇEK sembolleri için haber gelsin.
  const [portfolioStocks, , portfolioState] = useSyncedState({
    table: 'portfolios',
    column: 'stocks',
    localKey: 'portfoyai_stocks',
    seed: SEED_STOCKS,
    readOnly: true,
  });
  const [watchlistItems, , watchState] = useSyncedState({
    table: 'watchlists',
    column: 'items',
    localKey: 'portfoyai_watchlist',
    seed: SEED_WATCHLIST,
    readOnly: true,
  });
  const stocksLoading = portfolioState.loading || watchState.loading;

  useEffect(() => {
    if (stocksLoading) return undefined; // kullanıcının gerçek sembolleri yüklensin
    let cancelled = false;
    const allStocks = [...portfolioStocks, ...watchlistItems];
    const companyByTicker = new Map(allStocks.map((s) => [s.ticker, s.company]));

    async function load() {
      // İki sorgu paralel: (1) TÜM hisselerin haberleri (sembol filtresiz havuz) →
      // "Tüm Hisseler" kapsamında karışık gelir, (2) yalnızca portföy hisseleri için
      // ayrı sorgu → havuz limitine takılsa bile portföy haberleri kesin görünür.
      const [poolAll, portfolioArticles] = await Promise.all([
        fetchAllLiveNews({ limit: 400 }),
        portfolioStocks.length ? fetchLiveNews(portfolioStocks, { limit: 200 }) : Promise.resolve(null),
      ]);
      if (cancelled) return;

      // Havuz boşsa (ör. lokal Supabase yok) izlenen sembollere düşülür
      const base = poolAll ?? (await fetchLiveNews(allStocks, { limit: 300 }));
      if (cancelled) return;

      // Portföy haberleri önce; id bazında tekille (aynı haber iki sorgudan gelebilir)
      const seen = new Set();
      const merged = [...(portfolioArticles ?? []), ...(base ?? [])].filter((a) =>
        seen.has(a.id) ? false : (seen.add(a.id), true)
      );
      if (!merged.length) return;
      setLiveNews(merged.map((a) => mapLiveArticleToNews(a, companyByTicker)));
    }

    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // Stok listeleri yüklendikten sonra sayfa açıkken değişmez varsayılır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stocksLoading]);

  // Kapsam filtreleri için yardımcı kümeler
  const portfolioTickers = useMemo(
    () => new Set(portfolioStocks.map((s) => s.ticker)),
    [portfolioStocks]
  );
  const watchlistTickers = useMemo(
    () => new Set(watchlistItems.map((s) => s.ticker)),
    [watchlistItems]
  );
  const marketByTicker = useMemo(() => {
    const map = new Map();
    for (const s of [...portfolioStocks, ...watchlistItems]) {
      map.set(s.ticker, s.market === 'BIST' ? 'BIST' : 'ABD');
    }
    return map;
  }, [portfolioStocks, watchlistItems]);

  // Canlı haber geldiyse yalnızca gerçek haberler gösterilir; hiç canlı haber
  // yoksa örnek (mock) haberlerle dolu bir akış sunulur (boş ekran yerine).
  // Her habere bileşik "önem skoru" ve portföy/izleme ilgisi eklenir.
  const allNews = useMemo(
    () =>
      [...liveNews, ...(liveNews.length ? [] : MOCK_NEWS)].map((n) =>
        withNewsImportance(
          {
            ...n,
            market: n.market ?? marketByTicker.get(n.ticker) ?? null,
            isCatalyst: detectCatalyst(n),
          },
          { portfolioTickers, watchlistTickers }
        )
      ),
    [liveNews, marketByTicker, portfolioTickers, watchlistTickers]
  );

  // Hisse kodu yazdıkça canlı sembol önerisi (300ms debounce)
  useEffect(() => {
    if (skipTickerSearchRef.current) {
      skipTickerSearchRef.current = false;
      return undefined;
    }
    const q = tickerQuery.trim();
    if (q.length < 1) {
      setTickerSuggestions([]);
      setShowTickerSugg(false);
      setTickerFilter('all');
      return undefined;
    }
    const timer = setTimeout(async () => {
      const results = await searchSymbols(q);
      if (results) {
        setTickerSuggestions(results.slice(0, 8));
        setShowTickerSugg(results.length > 0);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [tickerQuery]);

  /** Öneriden hisse seçimi: filtre uygulanır, o hissenin haberleri hemen çekilir. */
  async function handlePickTicker(item) {
    skipTickerSearchRef.current = true;
    setTickerQuery(item.ticker);
    setTickerFilter(item.ticker);
    setShowTickerSugg(false);

    const articles = await fetchLiveNews([{ ticker: item.ticker, market: item.market }]);
    if (!articles) return;
    const companyMap = new Map([[item.ticker, item.name]]);
    const mapped = articles.map((a) => mapLiveArticleToNews(a, companyMap));
    setLiveNews((prev) => {
      const known = new Set(prev.map((n) => n.id));
      return [...mapped.filter((n) => !known.has(n.id)), ...prev];
    });
  }

  function clearTickerFilter() {
    skipTickerSearchRef.current = true;
    setTickerQuery('');
    setTickerFilter('all');
    setTickerSuggestions([]);
    setShowTickerSugg(false);
  }

  /** Kapsam değişince hisse alt-filtresi sıfırlanır (eski seçim listeyi boş bırakmasın). */
  function handleScopeChange(value) {
    setScope(value);
    setTickerFilter('all');
    if (tickerQuery) {
      skipTickerSearchRef.current = true;
      setTickerQuery('');
    }
  }

  /** Çip ile tek bir hisse seçimi (portföy/izleme kapsamında). */
  function pickScopeTicker(ticker) {
    setTickerFilter(ticker);
    if (tickerQuery) {
      skipTickerSearchRef.current = true;
      setTickerQuery('');
    }
  }

  // Portföy/izleme kapsamında, içinden hisse seçilebilen çip listesi
  const scopeTickers = useMemo(() => {
    if (scope === 'portfolio') return portfolioStocks;
    if (scope === 'watchlist') return watchlistItems;
    return null;
  }, [scope, portfolioStocks, watchlistItems]);

  const chipClass = (active) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? 'border-accent bg-accent text-white'
        : 'border-navy-700 bg-navy-900 text-slate-300 hover:bg-navy-800'
    }`;

  const filteredNews = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return allNews.filter((news) => {
      if (scope === 'portfolio' && !portfolioTickers.has(news.ticker)) return false;
      if (scope === 'watchlist' && !watchlistTickers.has(news.ticker)) return false;
      if (scope === 'bist' && news.market !== 'BIST') return false;
      if (scope === 'us' && news.market !== 'ABD') return false;
      if (tickerFilter !== 'all' && news.ticker !== tickerFilter) return false;
      if (typeFilter !== 'all' && news.type !== typeFilter) return false;
      if (sentimentFilter !== 'all' && news.sentiment !== sentimentFilter) return false;
      if (onlyImportant && news.importanceLevel === 'low') return false;
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
  }, [
    allNews,
    scope,
    portfolioTickers,
    watchlistTickers,
    tickerFilter,
    typeFilter,
    sentimentFilter,
    minReliability,
    searchQuery,
    onlyImportant,
  ]);

  // "Bugünün öne çıkanları": filtreye uyan haberler içinde önem skoru en
  // yüksek (düşük olmayan) ilk 3 haber. Sekmeden bağımsız, üstte sabit gösterilir.
  const highlights = useMemo(
    () =>
      [...filteredNews]
        .filter((n) => n.importanceLevel !== 'low')
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 3),
    [filteredNews]
  );

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
      <div data-tour="news-filters" className="rounded-xl border border-navy-700/60 bg-navy-900 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {/* Kapsam: hangi hisselerin haberleri? */}
          <select
            value={scope}
            onChange={(e) => handleScopeChange(e.target.value)}
            className={selectClass}
          >
            {SCOPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {/* Hisse arama: yazdıkça öneri çıkar, seçince o hissenin haberleri gelir */}
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={tickerQuery}
              onChange={(e) => setTickerQuery(e.target.value)}
              onFocus={() => tickerSuggestions.length > 0 && setShowTickerSugg(true)}
              onBlur={() => setTimeout(() => setShowTickerSugg(false), 150)}
              placeholder="Hisse ara (örn: MP)..."
              className={`${selectClass} w-full pl-9 pr-8`}
              autoComplete="off"
            />
            {tickerFilter !== 'all' && (
              <button
                type="button"
                onClick={clearTickerFilter}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-ink"
                aria-label="Hisse filtresini temizle"
              >
                <X size={13} />
              </button>
            )}
            {showTickerSugg && (
              <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-navy-600 bg-navy-850 shadow-2xl">
                {tickerSuggestions.map((item) => (
                  <li key={item.symbol}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handlePickTicker(item);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-navy-700/60"
                    >
                      <span className="text-sm font-bold text-ink">{item.ticker}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
                        {item.name}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          item.market === 'BIST'
                            ? 'bg-accent/15 text-accent-soft'
                            : 'bg-navy-800 text-slate-400'
                        }`}
                      >
                        {item.market}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Serbest metin araması */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Haber metni ara..."
              className={`${selectClass} w-full`}
            />
          </div>

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

      {/* Portföy/izleme kapsamında: içinden tek hisse seçilebilen çip listesi */}
      {scopeTickers && scopeTickers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-navy-700/60 bg-navy-900 p-3">
          <span className="text-xs font-medium text-slate-400">
            {scope === 'portfolio' ? 'Portföyündeki hisseler:' : 'İzleme listendeki hisseler:'}
          </span>
          <button
            type="button"
            onClick={() => setTickerFilter('all')}
            className={chipClass(tickerFilter === 'all')}
          >
            Tümü
          </button>
          {scopeTickers.map((s) => (
            <button
              key={s.ticker}
              type="button"
              onClick={() => pickScopeTicker(s.ticker)}
              className={chipClass(tickerFilter === s.ticker)}
              title={s.company ?? s.ticker}
            >
              {s.ticker}
            </button>
          ))}
        </div>
      )}

      {/* Bugünün öne çıkanları: önem skoru en yüksek 3 haber */}
      {highlights.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Flame size={15} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-ink">Bugünün öne çıkanları</h2>
            <span className="text-xs text-slate-500">
              güvenilirlik, etki, katalizör ve portföy ilginize göre seçildi
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {highlights.map((news) => (
              <NewsCard key={`hl-${news.id}`} news={news} onClick={setSelectedNews} />
            ))}
          </div>
        </section>
      )}

      {/* Tarih sekmeleri: en yeni → en eski */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
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
                <span className="ml-1.5 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] tabular-nums">
                  {newsPages[tab.index]?.length ?? 0}
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOnlyImportant((v) => !v)}
            aria-pressed={onlyImportant}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              onlyImportant
                ? 'border-accent bg-accent/12 text-accent-soft'
                : 'border-navy-700 text-slate-400 hover:bg-navy-800 hover:text-ink'
            }`}
            title="Düşük önemli (gürültü) haberleri gizle"
          >
            <Flame size={13} />
            Yalnızca önemli
          </button>
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
              ? scope === 'portfolio' || scope === 'watchlist'
                ? 'Bu hisseler için haberler toplanıyor olabilir; yeni eklenen semboller toplayıcının bir sonraki turunda (birkaç dakika) haber akışına girer. Filtreleri gevşetmeyi de deneyin.'
                : 'Filtreleri değiştirmeyi deneyin.'
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

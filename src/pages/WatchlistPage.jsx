import { useMemo, useRef, useState } from 'react';
import { Plus, ArrowDownWideNarrow, Hand, Eye, Target, TrendingUp, RefreshCw, WifiOff, Loader2 } from 'lucide-react';
import useLocalStorage from '../hooks/useLocalStorage.js';
import useSyncedState from '../hooks/useSyncedState.js';
import useLivePrices from '../hooks/useLivePrices.js';
import { SEED_WATCHLIST } from '../data/seedWatchlist.js';
import { SEED_STOCKS } from '../data/seedPortfolio.js';
import WatchlistCard, { getTargetInfo } from '../components/WatchlistCard.jsx';
import WatchlistFormModal from '../components/WatchlistFormModal.jsx';
import StockFormModal from '../components/StockFormModal.jsx';
import { formatPercent } from '../utils/portfolioCalculations.js';

const HORIZON_TABS = [
  { value: 'all', label: 'Tümü' },
  { value: 'long', label: 'Uzun Vade' },
  { value: 'short', label: 'Kısa Vade' },
];

function byDailyChangeDesc(a, b) {
  return b.dailyChangePercent - a.dailyChangePercent;
}

function SummaryChip({ icon: Icon, label, value, valueClass = 'text-white' }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-navy-700/60 bg-navy-900 px-3 py-2">
      <Icon size={15} className="text-accent-soft" />
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

export default function WatchlistPage() {
  // İzleme listesi ve "portföye taşı" hedefi artık hesaba bağlı (Supabase, çok
  // cihaz senkron, RLS izole); giriş yoksa localStorage'a düşer. İçerik yalnızca
  // veri yüklenince mount edilir (canlı fiyatlar doğru sembollerle çeksin).
  const [items, setItems, watchState] = useSyncedState({
    table: 'watchlists',
    column: 'items',
    localKey: 'portfoyai_watchlist',
    seed: SEED_WATCHLIST,
  });
  // Portföye taşıma aynı bulut portföyüne yazsın diye (PortfolioPage ile tutarlı)
  const [, setPortfolioStocks, portfolioState] = useSyncedState({
    table: 'portfolios',
    column: 'stocks',
    localKey: 'portfoyai_stocks',
    seed: SEED_STOCKS,
  });
  // Sıralama modu cihaza özel bir görünüm tercihi — lokal kalır
  const [sortMode, setSortMode] = useLocalStorage('portfoyai_watchlist_sort', 'auto');

  if (watchState.loading || portfolioState.loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={26} className="animate-spin text-accent-soft" />
      </div>
    );
  }

  return (
    <WatchlistContent
      items={items}
      setItems={setItems}
      setPortfolioStocks={setPortfolioStocks}
      sortMode={sortMode}
      setSortMode={setSortMode}
    />
  );
}

function WatchlistContent({ items, setItems, setPortfolioStocks, sortMode, setSortMode }) {
  const live = useLivePrices(items, setItems, { autoRefreshMs: 5 * 60 * 1000 });

  const [activeTab, setActiveTab] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [movingItem, setMovingItem] = useState(null); // Portföye taşınan izleme kaydı

  // Pointer tabanlı, eksen kilitli sürükleme durumu
  const listRef = useRef(null);
  const dragInfoRef = useRef(null);
  const [dragView, setDragView] = useState(null); // { id, fromIndex, targetIndex, translate, slotSize }

  const CARD_GAP = 12; // space-y-3

  /** Tam listenin o anki görünür sırası (manuel modda dizi sırası, otomatikte günlük değişim). */
  const orderedItems = useMemo(
    () => (sortMode === 'auto' ? [...items].sort(byDailyChangeDesc) : items),
    [items, sortMode]
  );

  const visibleItems = useMemo(
    () =>
      activeTab === 'all'
        ? orderedItems
        : orderedItems.filter((item) => item.horizon === activeTab),
    [orderedItems, activeTab]
  );

  const summary = useMemo(() => {
    if (items.length === 0) return null;
    const avgDaily = items.reduce((sum, i) => sum + i.dailyChangePercent, 0) / items.length;
    const reachedCount = items.filter((i) => getTargetInfo(i)?.reached).length;
    return { count: items.length, avgDaily, reachedCount };
  }, [items]);

  const tabCounts = useMemo(
    () => ({
      all: items.length,
      long: items.filter((i) => i.horizon === 'long').length,
      short: items.filter((i) => i.horizon === 'short').length,
    }),
    [items]
  );

  /** Sürükleme/ok ile taşıma: mevcut görünür sıra "pişirilir", taşıma uygulanır, mod manuel olur. */
  function reorder(sourceId, targetId) {
    if (!sourceId || sourceId === targetId) return;
    const list = sortMode === 'auto' ? [...items].sort(byDailyChangeDesc) : [...items];
    const fromIdx = list.findIndex((i) => i.id === sourceId);
    const toIdx = list.findIndex((i) => i.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    setItems(list);
    setSortMode('manual');
  }

  /** Ok butonları: aktif sekmedeki görünür komşusuyla yer değiştirir. */
  function moveItem(id, direction) {
    const idx = visibleItems.findIndex((i) => i.id === id);
    const neighbor = visibleItems[idx + direction];
    if (!neighbor) return;
    reorder(id, neighbor.id);
  }

  /**
   * Tutamaçtan başlatılan sürükleme: kart yalnızca Y ekseninde hareket eder,
   * hareket ilk kartın üstü ile son kartın altı arasına sıkıştırılır (clamp).
   * Diğer kartlar hedef konuma göre kayarak boşluk açar; bırakınca sıra kalıcılaşır.
   */
  function handleDragHandleDown(e, id, index) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();

    const cardEls = [...listRef.current.querySelectorAll('[data-watch-card]')];
    const rects = cardEls.map((el) => el.getBoundingClientRect());
    const visibleIds = visibleItems.map((i) => i.id);
    dragInfoRef.current = { id, index, startY: e.clientY, rects, visibleIds, targetIndex: index };
    setDragView({
      id,
      fromIndex: index,
      targetIndex: index,
      translate: 0,
      slotSize: rects[index].height + CARD_GAP,
    });

    const handleMove = (ev) => {
      const info = dragInfoRef.current;
      if (!info) return;
      const { rects: r, index: from } = info;

      // Y ekseni sınırı: ilk kartın üstünden yukarı, son kartın altından aşağı çıkılamaz
      let delta = ev.clientY - info.startY;
      const minDelta = r[0].top - r[from].top;
      const maxDelta = r[r.length - 1].bottom - r[from].bottom;
      delta = Math.max(minDelta, Math.min(maxDelta, delta));

      // Sürüklenen kartın merkezi hangi kartların orta çizgisini geçtiyse hedef orası
      const center = r[from].top + r[from].height / 2 + delta;
      let target = from;
      for (let i = 0; i < r.length; i++) {
        const midpoint = r[i].top + r[i].height / 2;
        if (i < from && center < midpoint) target = Math.min(target, i);
        if (i > from && center > midpoint) target = Math.max(target, i);
      }

      info.targetIndex = target;
      setDragView({
        id: info.id,
        fromIndex: from,
        targetIndex: target,
        translate: delta,
        slotSize: r[from].height + CARD_GAP,
      });
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      const info = dragInfoRef.current;
      if (info && info.targetIndex !== info.index) {
        reorder(info.id, info.visibleIds[info.targetIndex]);
      }
      dragInfoRef.current = null;
      setDragView(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  }

  /** Sürükleme sırasında her kartın anlık transform stili. */
  function getDragStyle(itemId, index) {
    if (!dragView) return undefined;
    if (itemId === dragView.id) {
      return {
        transform: `translateY(${dragView.translate}px)`,
        zIndex: 30,
        position: 'relative',
      };
    }
    const { fromIndex, targetIndex, slotSize } = dragView;
    let shift = 0;
    if (fromIndex < index && index <= targetIndex) shift = -slotSize;
    else if (targetIndex <= index && index < fromIndex) shift = slotSize;
    return { transform: `translateY(${shift}px)`, transition: 'transform 150ms ease' };
  }

  function handleSaveWatchItem(formData) {
    if (editingItem) {
      setItems((prev) =>
        prev.map((i) => (i.id === editingItem.id ? { ...formData, id: editingItem.id } : i))
      );
    } else {
      setItems((prev) => [...prev, { ...formData, id: crypto.randomUUID() }]);
    }
    setFormOpen(false);
    setEditingItem(null);
  }

  function handleDelete(item) {
    if (window.confirm(`${item.ticker} izleme listesinden silinsin mi?`)) {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    }
  }

  /** Portföye taşıma: StockFormModal ön dolu açılır; kayıtta portföye eklenir, izlemeden çıkar. */
  function handleSaveToPortfolio(stockData) {
    setPortfolioStocks((prev) => [...prev, { ...stockData, id: crypto.randomUUID() }]);
    setItems((prev) => prev.filter((i) => i.id !== movingItem.id));
    setMovingItem(null);
  }

  const prefillStock = movingItem
    ? {
        ticker: movingItem.ticker,
        company: movingItem.company,
        market: movingItem.market,
        sector: movingItem.sector,
        currency: movingItem.currency,
        currentPrice: movingItem.currentPrice,
        avgPrice: movingItem.currentPrice,
        dailyChangePercent: movingItem.dailyChangePercent,
        notes: movingItem.notes,
      }
    : null;

  return (
    <div className="space-y-5">
      {/* Başlık */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">İzleme Listesi</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">
            Henüz satın almadığınız, takip etmek istediğiniz hisseler. Kartları sürükleyerek
            sırayı değiştirebilir, dilediğinizde günlük değişime göre otomatik sıralamaya
            dönebilirsiniz.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {live.isOffline ? (
            <span
              className="flex items-center gap-1.5 rounded-lg border border-navy-700 px-3 py-2 text-xs text-slate-500"
              title="Canlı veri sunucusu kapalı. Başlatmak için: npm run server"
            >
              <WifiOff size={13} />
              Canlı veri kapalı
            </span>
          ) : (
            <button
              type="button"
              onClick={live.refresh}
              disabled={live.loading}
              className="flex items-center gap-1.5 rounded-lg border border-navy-700 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-navy-800 hover:text-white disabled:opacity-50"
              title={
                live.lastUpdated
                  ? `Son güncelleme: ${live.lastUpdated.toLocaleTimeString('tr-TR')}`
                  : 'Canlı fiyatları çek'
              }
            >
              <RefreshCw size={13} className={live.loading ? 'animate-spin' : ''} />
              {live.lastUpdated
                ? `Canlı • ${live.lastUpdated.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`
                : 'Canlı Fiyat'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setEditingItem(null);
              setFormOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-soft"
          >
            <Plus size={16} />
            Hisse Ekle
          </button>
        </div>
      </div>

      {/* Özet şeridi */}
      {summary && (
        <div className="flex flex-wrap gap-2">
          <SummaryChip icon={Eye} label="İzlenen" value={summary.count} />
          <SummaryChip
            icon={TrendingUp}
            label="Ort. günlük değişim"
            value={formatPercent(summary.avgDaily)}
            valueClass={summary.avgDaily >= 0 ? 'text-gain' : 'text-loss'}
          />
          <SummaryChip
            icon={Target}
            label="Hedefe ulaşan"
            value={summary.reachedCount}
            valueClass={summary.reachedCount > 0 ? 'text-gain' : 'text-white'}
          />
        </div>
      )}

      {/* Sekmeler + sıralama modu */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex overflow-hidden rounded-lg border border-navy-700">
          {HORIZON_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveTab(tab.value)}
              className={`px-3.5 py-2 text-xs font-medium transition-colors ${
                activeTab === tab.value
                  ? 'bg-accent text-white'
                  : 'text-slate-400 hover:bg-navy-800 hover:text-slate-200'
              }`}
            >
              {tab.label}
              <span className="ml-1.5 rounded bg-black/20 px-1 py-0.5 text-[10px] tabular-nums">
                {tabCounts[tab.value]}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {sortMode === 'manual' ? (
            <span className="flex items-center gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[11px] font-medium text-amber-400">
              <Hand size={12} />
              Manuel sıralama
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-md border border-navy-700 bg-navy-800 px-2 py-1 text-[11px] font-medium text-slate-400">
              <ArrowDownWideNarrow size={12} />
              Günlük değişime göre
            </span>
          )}
          <button
            type="button"
            onClick={() => setSortMode('auto')}
            disabled={sortMode === 'auto'}
            className="flex items-center gap-1.5 rounded-lg border border-navy-700 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-navy-800 disabled:cursor-default disabled:opacity-40"
            title="Günlük değişime göre otomatik sırala"
          >
            <ArrowDownWideNarrow size={13} />
            Otomatik Sırala
          </button>
        </div>
      </div>

      {/* Liste */}
      {visibleItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-navy-700 bg-navy-900/50 py-16 text-center">
          <Eye size={36} className="mb-3 text-slate-600" />
          <p className="font-medium text-slate-300">
            {items.length === 0 ? 'İzleme listeniz boş' : 'Bu sekmede izlenen hisse yok'}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            "Hisse Ekle" butonuyla takip etmek istediğiniz hisseyi ekleyin.
          </p>
        </div>
      ) : (
        <div ref={listRef} className="space-y-3">
          {visibleItems.map((item, index) => (
            <WatchlistCard
              key={item.id}
              item={item}
              index={index}
              isDragging={dragView?.id === item.id}
              dragStyle={getDragStyle(item.id, index)}
              onDragHandleDown={handleDragHandleDown}
              onMoveUp={(id) => moveItem(id, -1)}
              onMoveDown={(id) => moveItem(id, 1)}
              canMoveUp={index > 0}
              canMoveDown={index < visibleItems.length - 1}
              onEdit={(it) => {
                setEditingItem(it);
                setFormOpen(true);
              }}
              onDelete={handleDelete}
              onMoveToPortfolio={setMovingItem}
            />
          ))}
        </div>
      )}

      <p className="text-[11px] text-slate-600">
        Fiyat ve günlük değişim verileri şimdilik elle girilir; gerçek fiyat API'si bağlandığında
        otomatik güncellenecektir. Bu liste yatırım tavsiyesi değildir.
      </p>

      <WatchlistFormModal
        isOpen={formOpen}
        item={editingItem}
        onSave={handleSaveWatchItem}
        onClose={() => {
          setFormOpen(false);
          setEditingItem(null);
        }}
      />

      {/* Portföye taşıma: id'siz prefill ile "Yeni Hisse Ekle" modunda açılır */}
      <StockFormModal
        isOpen={Boolean(movingItem)}
        stock={prefillStock}
        onSave={handleSaveToPortfolio}
        onClose={() => setMovingItem(null)}
      />
    </div>
  );
}

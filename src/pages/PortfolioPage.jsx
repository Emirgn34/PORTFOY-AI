import { useEffect, useMemo, useState } from 'react';
import { Plus, PieChart as PieChartIcon, RefreshCw, WifiOff, Loader2, ListOrdered } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import useSyncedState from '../hooks/useSyncedState.js';
import useLivePrices from '../hooks/useLivePrices.js';
import { SEED_STOCKS } from '../data/seedPortfolio.js';
import PortfolioSummaryCards from '../components/PortfolioSummaryCards.jsx';
import PortfolioTable from '../components/PortfolioTable.jsx';
import StockAllocationPanel from '../components/StockAllocationPanel.jsx';
import { movePortfolioStock } from '../utils/portfolioOrder.js';
import HedgeShieldDashboard from '../components/HedgeShieldDashboard.tsx';
import StockFormModal from '../components/StockFormModal.jsx';
import {
  getPortfolioSummary,
  getSectorAllocation,
  getStockAllocation,
  getStockSortValue,
  getPortfolioPeriodProfit,
  formatCurrency,
  PERIOD_OPTIONS,
} from '../utils/portfolioCalculations.js';
import { fetchPeriodChanges } from '../services/liveData.js';
import { useTourAction } from '../tour/TourProvider.jsx';

const STORAGE_KEY = 'portfoyai_stocks';
// Sakin, finansa uygun kategorik palet (neon/AI tonları yerine yeşil–kum–nötr)
const CHART_COLORS = ['#244c3a', '#3f7d5e', '#6aa07f', '#9ab8a3', '#a06a24', '#c79a5b', '#687069', '#b0b7ac'];

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="shadow-pop rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-xs">
      <p className="font-semibold text-ink">{item.name}</p>
      <p className="text-slate-400">
        {formatCurrency(item.value)} ({item.payload.percent.toFixed(1)}%)
      </p>
    </div>
  );
}

export default function PortfolioPage() {
  // Portföy artık kullanıcı hesabına bağlı (Supabase, çok cihaz senkron, RLS
  // izole); giriş yoksa localStorage'a düşer. Veri kullanıcının kendi satırından
  // gelene kadar içerik mount edilmez ki canlı fiyatlar doğru sembollerle çeksin.
  const [stocks, setStocks, sync] = useSyncedState({
    table: 'portfolios',
    column: 'stocks',
    localKey: STORAGE_KEY,
    seed: SEED_STOCKS,
  });

  if (sync.loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={26} className="animate-spin text-accent-soft" />
      </div>
    );
  }

  if (sync.loadError) {
    return <div role="alert" className="rounded-xl border border-amber-500/30 bg-navy-900 p-6 text-sm text-slate-300">Portföy yüklenemedi. Yeniden denediğinizde kayıtlı verileriniz tekrar okunacak.<button type="button" onClick={sync.reload} className="ml-3 text-accent-soft underline">Tekrar dene</button></div>;
  }
  return <PortfolioContent stocks={stocks} setStocks={setStocks} sync={sync} />;
}

function PortfolioContent({ stocks, setStocks, sync }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStock, setEditingStock] = useState(null);
  const [period, setPeriod] = useState('day');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'desc' });
  const tourAction = useTourAction();
  const tourModalOpen = tourAction === 'openModal' || tourAction === 'openModalAdvanced';
  const live = useLivePrices(stocks, setStocks, { autoRefreshMs: 5 * 60 * 1000 });

  const summary = useMemo(() => getPortfolioSummary(stocks), [stocks]);

  // "Toplam Kar/Zarar" kartı için dönem seçimi (Toplam / 1G / 1H / 1A / 3A / 1Y / 3Y / 5Y)
  const [profitPeriod, setProfitPeriod] = useState('total');
  const [periodChanges, setPeriodChanges] = useState(null);
  const [periodLoading, setPeriodLoading] = useState(false);

  // Portföy bileşimi değişince (sembol/pazar) geçmiş veri yeniden çekilir;
  // canlı fiyat tiklerinde gereksiz çekim olmasın diye yalnızca sembol anahtarı izlenir.
  const symbolsKey = useMemo(
    () => stocks.map((s) => `${s.market}:${s.ticker}`).sort().join(','),
    [stocks]
  );

  useEffect(() => {
    if (profitPeriod === 'total') {
      setPeriodChanges(null);
      setPeriodLoading(false);
      return undefined;
    }
    let cancelled = false;
    setPeriodLoading(true);
    fetchPeriodChanges(stocks, profitPeriod).then((changes) => {
      if (cancelled) return;
      setPeriodChanges(changes);
      setPeriodLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profitPeriod, symbolsKey]);

  // Seçilen dönemin K/Z'si (Toplam ise klasik toplam, değilse geçmişe göre)
  const periodProfit = useMemo(() => {
    if (profitPeriod === 'total') {
      return { profit: summary.totalProfit, percent: summary.totalProfitPercent, covered: true };
    }
    return getPortfolioPeriodProfit(stocks, periodChanges);
  }, [profitPeriod, summary, stocks, periodChanges]);

  const sortedStocks = useMemo(() => {
    if (!sortConfig.key) return stocks;
    const sorted = [...stocks].sort((a, b) => {
      const va = getStockSortValue(a, sortConfig.key, period);
      const vb = getStockSortValue(b, sortConfig.key, period);
      if (typeof va === 'string') return va.localeCompare(vb, 'tr');
      return va - vb;
    });
    return sortConfig.direction === 'desc' ? sorted.reverse() : sorted;
  }, [stocks, sortConfig, period]);

  function handleSort(key) {
    setSortConfig((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === 'desc' ? 'asc' : 'desc' }
        : { key, direction: 'desc' }
    );
  }
  function handleReorder(activeId, overId) {
    setStocks((prev) => movePortfolioStock(prev, activeId, overId));
    void sync.flush();
  }
  const sectorAllocation = useMemo(() => getSectorAllocation(stocks), [stocks]);
  const stockAllocation = useMemo(() => getStockAllocation(stocks), [stocks]);

  function openAddModal() {
    setEditingStock(null);
    setModalOpen(true);
  }

  function openEditModal(stock) {
    setEditingStock(stock);
    setModalOpen(true);
  }

  function handleSave(formData) {
    if (editingStock) {
      setStocks((prev) =>
        prev.map((s) => (s.id === editingStock.id ? { ...formData, id: editingStock.id } : s))
      );
    } else {
      setStocks((prev) => [...prev, { ...formData, id: crypto.randomUUID() }]);
    }
    setModalOpen(false);
  }

  function handleDelete(stock) {
    if (window.confirm(`${stock.ticker} portföyden silinsin mi?`)) {
      setStocks((prev) => prev.filter((s) => s.id !== stock.id));
    }
  }

  return (
    <div className="space-y-6">
      <div data-tour="portfolio-summary">
        <PortfolioSummaryCards
          summary={summary}
          profitPeriod={profitPeriod}
          onProfitPeriodChange={setProfitPeriod}
          profit={periodProfit.profit}
          profitPercent={periodProfit.percent}
          periodLoading={periodLoading}
          periodAvailable={periodProfit.covered}
        />
      </div>

      <HedgeShieldDashboard />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Hisselerim
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setSortConfig({ key: null, direction: 'desc' })} aria-pressed={!sortConfig.key} className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium ${!sortConfig.key ? 'border-accent/40 bg-accent/10 text-accent-soft' : 'border-navy-700 text-slate-400'}`}><ListOrdered size={14} />Kişisel sıra</button>
          {/* Canlı fiyat güncelleme (lokal veri sunucusu) */}
          {live.isOffline ? (
            <span
              data-tour="live-price"
              className="flex items-center gap-1.5 rounded-lg border border-navy-700 px-3 py-2 text-xs text-slate-500"
              title="Canlı veri sunucusu kapalı. Başlatmak için: npm run server"
            >
              <WifiOff size={13} />
              Canlı veri kapalı
            </span>
          ) : (
            <button
              type="button"
              data-tour="live-price"
              onClick={live.refresh}
              disabled={live.loading}
              className="flex items-center gap-1.5 rounded-lg border border-navy-700 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-navy-800 hover:text-ink disabled:opacity-50"
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
          {/* Dönem seçici: "Dönem K/Z" kolonunun hangi dönemi göstereceğini belirler */}
          <div className="flex overflow-hidden rounded-lg border border-navy-700">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPeriod(option.value)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  period === option.value
                    ? 'bg-accent text-on-accent'
                    : 'text-slate-400 hover:bg-navy-800 hover:text-slate-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            data-tour="add-stock"
            onClick={openAddModal}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-soft"
          >
            <Plus size={16} />
            Hisse Ekle
          </button>
        </div>
      </div>

      <div data-tour="portfolio-table">
        <PortfolioTable
          stocks={sortedStocks}
          onEdit={openEditModal}
          onDelete={handleDelete}
          sortConfig={sortConfig}
          onSort={handleSort}
          period={period}
          onReorder={handleReorder}
        />
      </div>
      <div aria-live="polite" className="flex flex-wrap items-center gap-2 text-xs">
        {sync.saveStatus === 'saving' && <span className="text-slate-400">Kaydediliyor…</span>}
        {sync.saveStatus === 'saved' && <span className="text-accent-soft">{sync.cloud ? 'Düzen hesabınıza kaydedildi.' : 'Düzen bu cihaza kaydedildi.'}</span>}
        {sync.saveStatus === 'error' && <><span role="alert" className="text-amber-300">Değişiklikler kaydedilemedi.</span><button type="button" onClick={sync.retrySave} className="text-accent-soft underline">Kaydı tekrar dene</button></>}
      </div>
      <p className="text-[11px] text-slate-500">
        Kişisel sırada, hissenin yanındaki tutamacı basılı tutup yukarı veya aşağı taşıyın.
        Klavyede tutamaca odaklanıp ok tuşlarını kullanın. Kolon başlıklarıyla geçici sıralama yapabilirsiniz.
      </p>

      {stocks.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Sektöre göre dağılım — donut grafik */}
          <div className="rounded-xl border border-navy-700/60 bg-navy-900 p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink">
              <PieChartIcon size={16} className="text-accent-soft" />
              Sektöre Göre Dağılım
            </h3>
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="h-48 w-48 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sectorAllocation}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={3}
                      stroke="none"
                    >
                      {sectorAllocation.map((entry, i) => (
                        <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="w-full space-y-2">
                {sectorAllocation.map((sector, i) => (
                  <li key={sector.name} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    <span className="text-slate-300">{sector.name}</span>
                    <span className="ml-auto font-semibold tabular-nums text-ink">
                      {sector.percent.toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <StockAllocationPanel allocation={stockAllocation} />
        </div>
      )}

      <StockFormModal
        key={tourAction || 'manual'}
        isOpen={modalOpen || tourModalOpen}
        stock={tourModalOpen ? null : editingStock}
        onSave={handleSave}
        onClose={() => setModalOpen(false)}
        tourOpenAdvanced={tourAction === 'openModalAdvanced'}
      />
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Plus, PieChart as PieChartIcon, BarChart3, RefreshCw, WifiOff, Loader2 } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import useSyncedState from '../hooks/useSyncedState.js';
import useLivePrices from '../hooks/useLivePrices.js';
import { SEED_STOCKS } from '../data/seedPortfolio.js';
import PortfolioSummaryCards from '../components/PortfolioSummaryCards.jsx';
import PortfolioTable from '../components/PortfolioTable.jsx';
import StockFormModal from '../components/StockFormModal.jsx';
import {
  getPortfolioSummary,
  getSectorAllocation,
  getStockAllocation,
  getStockSortValue,
  formatCurrency,
  PERIOD_OPTIONS,
} from '../utils/portfolioCalculations.js';

const STORAGE_KEY = 'portfoyai_stocks';
const CHART_COLORS = ['#6366f1', '#22c55e', '#06b6d4', '#a855f7', '#f59e0b', '#ec4899', '#14b8a6', '#f43f5e'];

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-lg border border-navy-700 bg-navy-850 px-3 py-2 text-xs shadow-xl">
      <p className="font-semibold text-white">{item.name}</p>
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
  const [stocks, setStocks, { loading }] = useSyncedState({
    table: 'portfolios',
    column: 'stocks',
    localKey: STORAGE_KEY,
    seed: SEED_STOCKS,
  });

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={26} className="animate-spin text-accent-soft" />
      </div>
    );
  }

  return <PortfolioContent stocks={stocks} setStocks={setStocks} />;
}

function PortfolioContent({ stocks, setStocks }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStock, setEditingStock] = useState(null);
  const [period, setPeriod] = useState('day');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'desc' });
  const [tourAdvanced, setTourAdvanced] = useState(false);
  const live = useLivePrices(stocks, setStocks, { autoRefreshMs: 5 * 60 * 1000 });

  // Site eğitimi (tur) "Hisse Ekle" formunu açıp kapatabilsin
  useEffect(() => {
    const handler = (e) => {
      const action = e.detail;
      if (action === 'openModal' || action === 'openModalAdvanced') {
        setEditingStock(null);
        setModalOpen(true);
        setTourAdvanced(action === 'openModalAdvanced');
      } else {
        setModalOpen(false);
        setTourAdvanced(false);
      }
    };
    window.addEventListener('tour:action', handler);
    return () => window.removeEventListener('tour:action', handler);
  }, []);

  const summary = useMemo(() => getPortfolioSummary(stocks), [stocks]);

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
        <PortfolioSummaryCards summary={summary} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Hisselerim
        </h2>
        <div className="flex items-center gap-2">
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
          {/* Dönem seçici: "Dönem K/Z" kolonunun hangi dönemi göstereceğini belirler */}
          <div className="flex overflow-hidden rounded-lg border border-navy-700">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPeriod(option.value)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  period === option.value
                    ? 'bg-accent text-white'
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
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-soft"
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
        />
      </div>
      <p className="-mt-4 text-[11px] text-slate-600">
        Kolon başlıklarına tıklayarak sıralayabilirsiniz; "Toplam Maliyet" en çok para yatırılan
        sıralamasını verir. Dönemsel değişim yüzdeleri şimdilik elle girilir, ileride fiyat
        API'sinden otomatik dolacaktır.
      </p>

      {stocks.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Sektöre göre dağılım — donut grafik */}
          <div className="rounded-xl border border-navy-700/60 bg-navy-900 p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
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
                    <span className="ml-auto font-semibold tabular-nums text-white">
                      {sector.percent.toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Hisseye göre dağılım — progress barlar */}
          <div className="rounded-xl border border-navy-700/60 bg-navy-900 p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <BarChart3 size={16} className="text-accent-soft" />
              Hisseye Göre Dağılım
            </h3>
            <ul className="space-y-3">
              {stockAllocation.map((item, i) => (
                <li key={item.name}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-300">{item.name}</span>
                    <span className="tabular-nums text-slate-400">
                      {formatCurrency(item.value)} •{' '}
                      <span className="font-semibold text-white">{item.percent.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-navy-700/70">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${item.percent}%`,
                        backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[11px] text-slate-600">
              * Dağılımlar, farklı para birimleri sabit örnek kurlarla TRY'ye çevrilerek hesaplanır.
            </p>
          </div>
        </div>
      )}

      <StockFormModal
        isOpen={modalOpen}
        stock={editingStock}
        onSave={handleSave}
        onClose={() => setModalOpen(false)}
        tourOpenAdvanced={tourAdvanced}
      />
    </div>
  );
}

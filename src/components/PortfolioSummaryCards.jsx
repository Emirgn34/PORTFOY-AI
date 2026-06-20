import { useState } from 'react';
import { Wallet, Banknote, TrendingUp, TrendingDown, Percent, Layers, ChevronDown, Loader2 } from 'lucide-react';
import { formatCurrency, formatPercent, PROFIT_PERIODS } from '../utils/portfolioCalculations.js';

function SummaryCard({ icon: Icon, label, value, accent = 'text-ink', iconBg = 'bg-accent/12 text-accent' }) {
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-900 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
          <Icon size={16} />
        </span>
      </div>
      <p className={`mt-3 truncate text-xl font-semibold tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}

/** Kar/Zarar kartı: tıklayınca dönem (Toplam / 1G / 1H / 1A / 3A / 1Y / 3Y / 5Y) seçilir. */
function ProfitPeriodCard({ period, onChange, profit, loading, available }) {
  const [open, setOpen] = useState(false);
  const opt = PROFIT_PERIODS.find((p) => p.value === period) ?? PROFIT_PERIODS[0];
  const isGain = profit >= 0;
  const color = isGain ? 'text-gain' : 'text-loss';
  const iconBg = isGain ? 'bg-gain/15 text-gain' : 'bg-loss/15 text-loss';
  const Icon = isGain ? TrendingUp : TrendingDown;
  const showDash = period !== 'total' && !loading && !available;

  return (
    <div className="relative rounded-xl border border-navy-700 bg-navy-900 p-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="block w-full text-left"
        title="Dönem seçmek için tıklayın"
      >
        <span className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1 truncate text-xs font-medium uppercase tracking-wide text-slate-500">
            {opt.cardLabel}
            <ChevronDown size={12} className="shrink-0 text-slate-400" />
          </span>
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
            <Icon size={16} />
          </span>
        </span>
        <span className={`mt-3 block truncate text-xl font-semibold tabular-nums ${color}`}>
          {loading ? (
            <Loader2 size={18} className="animate-spin text-slate-400" />
          ) : showDash ? (
            <span className="text-slate-500">—</span>
          ) : (
            formatCurrency(profit)
          )}
        </span>
      </button>

      {open && (
        <>
          {/* Dışarı tıklayınca kapanması için saydam arka katman */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul className="shadow-pop absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-navy-600 bg-navy-900">
            {PROFIT_PERIODS.map((p) => (
              <li key={p.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(p.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-navy-800 ${
                    p.value === period ? 'bg-accent/8 font-semibold text-accent-soft' : 'text-slate-400'
                  }`}
                >
                  {p.label}
                  {p.value === period && <span className="text-accent-soft">●</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function PortfolioSummaryCards({
  summary,
  profitPeriod = 'total',
  onProfitPeriodChange,
  profit,
  profitPercent,
  periodLoading = false,
  periodAvailable = true,
}) {
  // Dönem seçilmemişse (Toplam) klasik toplam K/Z gösterilir
  const shownProfit = profitPeriod === 'total' ? summary.totalProfit : profit;
  const shownPercent = profitPeriod === 'total' ? summary.totalProfitPercent : profitPercent;
  const isGain = shownProfit >= 0;
  const profitColor = isGain ? 'text-gain' : 'text-loss';
  const profitIconBg = isGain ? 'bg-gain/15 text-gain' : 'bg-loss/15 text-loss';
  const percentDash = profitPeriod !== 'total' && !periodLoading && !periodAvailable;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <SummaryCard
        icon={Wallet}
        label="Toplam Portföy Değeri"
        value={formatCurrency(summary.totalValue)}
      />
      <SummaryCard
        icon={Banknote}
        label="Toplam Maliyet"
        value={formatCurrency(summary.totalCost)}
        iconBg="bg-slate-400/15 text-slate-300"
      />
      <ProfitPeriodCard
        period={profitPeriod}
        onChange={onProfitPeriodChange}
        profit={shownProfit}
        loading={periodLoading}
        available={periodAvailable}
      />
      <SummaryCard
        icon={Percent}
        label="Kar/Zarar Yüzdesi"
        value={periodLoading ? '…' : percentDash ? '—' : formatPercent(shownPercent)}
        accent={profitColor}
        iconBg={profitIconBg}
      />
      <SummaryCard
        icon={Layers}
        label="Hisse Sayısı"
        value={summary.stockCount}
        iconBg="bg-navy-800 text-slate-400"
      />
    </div>
  );
}

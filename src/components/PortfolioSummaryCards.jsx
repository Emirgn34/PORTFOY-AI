import { Wallet, Banknote, TrendingUp, TrendingDown, Percent, Layers } from 'lucide-react';
import { formatCurrency, formatPercent } from '../utils/portfolioCalculations.js';

function SummaryCard({ icon: Icon, label, value, accent = 'text-white', iconBg = 'bg-accent/15 text-accent-soft' }) {
  return (
    <div className="rounded-xl border border-navy-700/60 bg-navy-900 p-4">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
          <Icon size={19} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs text-slate-400">{label}</p>
          <p className={`truncate text-lg font-bold tabular-nums ${accent}`}>{value}</p>
        </div>
      </div>
    </div>
  );
}

export default function PortfolioSummaryCards({ summary }) {
  const isGain = summary.totalProfit >= 0;
  const profitColor = isGain ? 'text-gain' : 'text-loss';
  const profitIconBg = isGain ? 'bg-gain/15 text-gain' : 'bg-loss/15 text-loss';

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
      <SummaryCard
        icon={isGain ? TrendingUp : TrendingDown}
        label="Toplam Kar/Zarar"
        value={formatCurrency(summary.totalProfit)}
        accent={profitColor}
        iconBg={profitIconBg}
      />
      <SummaryCard
        icon={Percent}
        label="Kar/Zarar Yüzdesi"
        value={formatPercent(summary.totalProfitPercent)}
        accent={profitColor}
        iconBg={profitIconBg}
      />
      <SummaryCard
        icon={Layers}
        label="Hisse Sayısı"
        value={summary.stockCount}
        iconBg="bg-violet-400/15 text-violet-300"
      />
    </div>
  );
}

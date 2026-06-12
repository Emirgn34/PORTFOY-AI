import { Pencil, Trash2, Inbox, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import {
  getStockMetrics,
  getPeriodChange,
  formatCurrency,
  formatPercent,
  formatNumber,
  PERIOD_OPTIONS,
} from '../utils/portfolioCalculations.js';

function SortIcon({ column, sortConfig }) {
  if (sortConfig.key !== column) {
    return <ArrowUpDown size={12} className="text-slate-600" />;
  }
  return sortConfig.direction === 'desc' ? (
    <ArrowDown size={12} className="text-accent-soft" />
  ) : (
    <ArrowUp size={12} className="text-accent-soft" />
  );
}

export default function PortfolioTable({ stocks, onEdit, onDelete, sortConfig, onSort, period }) {
  const periodLabel = PERIOD_OPTIONS.find((p) => p.value === period)?.label ?? 'Gün';

  const columns = [
    { key: 'ticker', label: 'Hisse', sortable: true },
    { key: 'company', label: 'Şirket' },
    { key: 'sector', label: 'Sektör', sortable: true },
    { key: 'quantity', label: 'Adet', sortable: true, align: 'right' },
    { key: 'avgPrice', label: 'Ort. Alış', align: 'right' },
    { key: 'currentPrice', label: 'Güncel Fiyat', align: 'right' },
    { key: 'totalCost', label: 'Toplam Maliyet', sortable: true, align: 'right' },
    { key: 'currentValue', label: 'Güncel Değer', sortable: true, align: 'right' },
    { key: 'profit', label: 'Kar/Zarar', sortable: true, align: 'right' },
    { key: 'profitPercent', label: 'K/Z %', sortable: true, align: 'right' },
    { key: 'periodChange', label: `${periodLabel} K/Z`, sortable: true, align: 'right' },
    { key: 'actions', label: 'İşlemler', align: 'center' },
  ];

  if (stocks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-navy-700 bg-navy-900/50 py-16 text-center">
        <Inbox size={36} className="mb-3 text-slate-600" />
        <p className="font-medium text-slate-300">Portföyünüz boş</p>
        <p className="mt-1 text-sm text-slate-500">
          "Hisse Ekle" butonuyla ilk hissenizi ekleyin.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-navy-700/60 bg-navy-900">
      <table className="w-full min-w-[1000px] text-sm">
        <thead>
          <tr className="border-b border-navy-700/60 text-left text-xs uppercase tracking-wide text-slate-500">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 font-medium ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}
              >
                {col.sortable ? (
                  <button
                    type="button"
                    onClick={() => onSort(col.key)}
                    className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-slate-300 ${
                      sortConfig.key === col.key ? 'text-accent-soft' : ''
                    }`}
                  >
                    {col.label}
                    <SortIcon column={col.key} sortConfig={sortConfig} />
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stocks.map((stock) => {
            const m = getStockMetrics(stock);
            const profitColor = m.profit >= 0 ? 'text-gain' : 'text-loss';
            const periodChange = getPeriodChange(stock, period);
            const periodColor =
              periodChange.percent == null
                ? 'text-slate-600'
                : periodChange.percent >= 0
                  ? 'text-gain'
                  : 'text-loss';

            return (
              <tr
                key={stock.id}
                className="border-b border-navy-800 transition-colors last:border-0 hover:bg-navy-850"
              >
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="font-bold text-white">{stock.ticker}</span>
                    <span className="text-[11px] text-slate-500">{stock.market}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-300">{stock.company}</td>
                <td className="px-4 py-3">
                  <span className="rounded-md bg-navy-700/60 px-2 py-0.5 text-xs text-slate-300">
                    {stock.sector || 'Diğer'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                  {formatNumber(stock.quantity)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                  {formatCurrency(stock.avgPrice, stock.currency)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                  {formatCurrency(stock.currentPrice, stock.currency)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                  {formatCurrency(m.totalCost, stock.currency)}
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums text-white">
                  {formatCurrency(m.currentValue, stock.currency)}
                </td>
                <td className={`px-4 py-3 text-right font-medium tabular-nums ${profitColor}`}>
                  {formatCurrency(m.profit, stock.currency)}
                </td>
                <td className={`px-4 py-3 text-right font-semibold tabular-nums ${profitColor}`}>
                  {formatPercent(m.profitPercent)}
                </td>
                <td className={`px-4 py-3 text-right tabular-nums ${periodColor}`}>
                  {periodChange.percent == null ? (
                    '—'
                  ) : (
                    <div className="flex flex-col items-end">
                      <span className="font-semibold">{formatPercent(periodChange.percent)}</span>
                      <span className="text-[11px] opacity-80">
                        {formatCurrency(periodChange.amount, stock.currency)}
                      </span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      type="button"
                      onClick={() => onEdit(stock)}
                      className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-accent/15 hover:text-accent-soft"
                      title="Düzenle"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(stock)}
                      className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-loss/15 hover:text-loss"
                      title="Sil"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

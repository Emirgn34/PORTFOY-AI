import {
  GripVertical,
  ChevronUp,
  ChevronDown,
  Pencil,
  Trash2,
  Target,
  CalendarPlus,
  Briefcase,
} from 'lucide-react';
import { formatCurrency, formatPercent } from '../utils/portfolioCalculations.js';

/**
 * Hedef fiyat bilgisi: hedef, baz fiyatın altındaysa "düşüş bekleyen alım hedefi",
 * üstündeyse "yükseliş hedefi" kabul edilir; ulaşılma kontrolü yöne göre yapılır.
 */
export function getTargetInfo(item) {
  const target = Number(item.targetPrice);
  if (!target) return null;

  const current = Number(item.currentPrice);
  const baseline = Number(item.priceWhenAdded) || current;
  const isDipTarget = target <= baseline;
  const reached = isDipTarget ? current <= target : current >= target;
  const distancePercent = Math.abs(((target - current) / current) * 100);

  return { target, reached, distancePercent, isDipTarget };
}

export function getSinceAddedPercent(item) {
  const base = Number(item.priceWhenAdded);
  if (!base) return null;
  return ((Number(item.currentPrice) - base) / base) * 100;
}

const HORIZON_BADGES = {
  long: { label: 'Uzun Vade', className: 'bg-accent/12 text-accent-soft' },
  short: { label: 'Kısa Vade', className: 'bg-navy-800 text-slate-400' },
};

function Stat({ label, children }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

export default function WatchlistCard({
  item,
  index,
  isDragging,
  dragStyle,
  onDragHandleDown,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onEdit,
  onDelete,
  onMoveToPortfolio,
}) {
  const dailyColor = item.dailyChangePercent >= 0 ? 'text-gain' : 'text-loss';
  const sinceAdded = getSinceAddedPercent(item);
  const targetInfo = getTargetInfo(item);
  const horizon = HORIZON_BADGES[item.horizon] ?? HORIZON_BADGES.long;
  const addedDate = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(
    new Date(item.addedAt)
  );

  return (
    <article
      data-watch-card
      style={dragStyle}
      className={`select-none rounded-xl border bg-navy-900 p-4 ${
        isDragging
          ? 'border-accent shadow-xl shadow-black/50'
          : 'border-navy-700/60 transition-shadow duration-200 hover:border-navy-600 hover:shadow-lg hover:shadow-black/30'
      }`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        {/* Sürükleme + sıra kontrolleri */}
        <div className="flex items-center gap-2 lg:shrink-0">
          <span
            onPointerDown={(e) => onDragHandleDown(e, item.id, index)}
            style={{ touchAction: 'none' }}
            className={`rounded p-1 text-slate-600 hover:bg-navy-800 hover:text-slate-400 ${
              isDragging ? 'cursor-grabbing text-accent-soft' : 'cursor-grab'
            }`}
            title="Sürükleyerek taşı (yalnızca dikey)"
          >
            <GripVertical size={18} />
          </span>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-700/70 text-sm font-bold text-ink">
            {index + 1}
          </span>
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => onMoveUp(item.id)}
              disabled={!canMoveUp}
              className="rounded p-0.5 text-slate-500 transition-colors hover:bg-navy-800 hover:text-ink disabled:cursor-default disabled:opacity-30"
              title="Yukarı taşı"
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              onClick={() => onMoveDown(item.id)}
              disabled={!canMoveDown}
              className="rounded p-0.5 text-slate-500 transition-colors hover:bg-navy-800 hover:text-ink disabled:cursor-default disabled:opacity-30"
              title="Aşağı taşı"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        </div>

        {/* Kimlik */}
        <div className="min-w-0 lg:w-52 lg:shrink-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-bold text-ink">{item.ticker}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${horizon.className}`}>
              {horizon.label}
            </span>
          </div>
          <p className="truncate text-xs text-slate-500">{item.company}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="rounded bg-navy-700/60 px-1.5 py-0.5 text-[10px] text-slate-400">
              {item.market}
            </span>
            {item.sector && (
              <span className="rounded bg-navy-700/60 px-1.5 py-0.5 text-[10px] text-slate-400">
                {item.sector}
              </span>
            )}
          </div>
        </div>

        {/* Fiyat + günlük değişim */}
        <div className="lg:w-36 lg:shrink-0">
          <p className="text-base font-semibold tabular-nums text-ink">
            {formatCurrency(item.currentPrice, item.currency)}
          </p>
          <p className={`text-xl font-bold tabular-nums ${dailyColor}`}>
            {formatPercent(item.dailyChangePercent)}
            <span className="ml-1 text-[10px] font-normal text-slate-500">bugün</span>
          </p>
        </div>

        {/* Eklendiğinden beri + hedef */}
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-2">
          <Stat label="Eklendiğinden Beri">
            {sinceAdded == null ? (
              <span className="text-sm text-slate-500">—</span>
            ) : (
              <span className={`text-sm font-semibold tabular-nums ${sinceAdded >= 0 ? 'text-gain' : 'text-loss'}`}>
                {formatPercent(sinceAdded)}
              </span>
            )}
            <p className="flex items-center gap-1 text-[10px] text-slate-600">
              <CalendarPlus size={10} />
              {addedDate}
            </p>
          </Stat>
          <Stat label="Hedef Fiyat">
            {!targetInfo ? (
              <span className="text-sm text-slate-500">—</span>
            ) : targetInfo.reached ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-gain/30 bg-gain/15 px-1.5 py-0.5 text-xs font-semibold text-gain">
                <Target size={11} />
                Hedefe ulaştı
              </span>
            ) : (
              <>
                <span className="text-sm font-semibold tabular-nums text-slate-200">
                  {formatCurrency(targetInfo.target, item.currency)}
                </span>
                <p className="text-[10px] text-slate-500">
                  hedefe %{targetInfo.distancePercent.toFixed(1)}{' '}
                  {targetInfo.isDipTarget ? 'düşüş' : 'yükseliş'} kaldı
                </p>
              </>
            )}
          </Stat>
          {item.notes && (
            <p className="col-span-2 line-clamp-1 text-xs italic text-slate-500">{item.notes}</p>
          )}
        </div>

        {/* Aksiyonlar */}
        <div className="flex items-center justify-end gap-1.5 lg:shrink-0">
          <button
            type="button"
            onClick={() => onMoveToPortfolio(item)}
            className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent-soft transition-colors hover:bg-accent hover:text-white"
            title="Bu hisseyi portföyüne ekle ve izlemeden çıkar"
          >
            <Briefcase size={13} />
            Portföye Taşı
          </button>
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-accent/15 hover:text-accent-soft"
            title="Düzenle"
          >
            <Pencil size={15} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(item)}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-loss/15 hover:text-loss"
            title="Sil"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

import { Anchor, Ban } from 'lucide-react';
import { formatCurrency } from '../utils/portfolioCalculations.js';

/**
 * "Bu hisse normalde nerede geziyor?" kartı.
 *
 * Tipik işlem bandını (son ~1 yılın tazelik ağırlıklı %20–%80 aralığı) bir
 * şerit üzerinde gösterir; üzerine bugünkü fiyatı ve geçmişte birden çok kez
 * dokunulmuş destek/direnç seviyelerini işaretler. Veri yoksa (hafif analiz)
 * bileşen hiç render edilmez.
 */
export default function PriceLevelsCard({ structure, price, currency }) {
  if (!structure || !price) return null;

  const { bandLow, bandHigh, bandMid, pctVsBandMid, bandPosition, supports, resistances } =
    structure;

  const allLevels = [...supports, ...resistances].map((l) => l.level);
  const lo = Math.min(bandLow, price, ...allLevels);
  const hi = Math.max(bandHigh, price, ...allLevels);
  const pad = (hi - lo || price * 0.05) * 0.1;
  const min = lo - pad;
  const max = hi + pad;
  const pos = (v) => ((v - min) / (max - min)) * 100;

  const fmt = (v) => formatCurrency(v, currency);

  const positionText =
    bandPosition === 'below'
      ? `Şu anki fiyat, bandın ortasının %${Math.abs(pctVsBandMid)} ALTINDA.`
      : bandPosition === 'above'
        ? `Şu anki fiyat, bandın ortasının %${Math.abs(pctVsBandMid)} ÜSTÜNDE.`
        : `Şu anki fiyat bandın içinde (ortaya göre %${pctVsBandMid > 0 ? '+' : ''}${pctVsBandMid}).`;

  const positionClass =
    bandPosition === 'below' ? 'text-gain' : bandPosition === 'above' ? 'text-amber-400' : 'text-slate-400';

  return (
    <div className="rounded-lg border border-navy-700/60 bg-navy-850 p-4">
      <p className="text-sm leading-relaxed text-slate-300">
        Bu hisse son {structure.bandDays} işlem gününün çoğunu{' '}
        <span className="font-semibold text-ink">
          {fmt(bandLow)} – {fmt(bandHigh)}
        </span>{' '}
        aralığında geçirdi.{' '}
        <span className={`font-semibold ${positionClass}`}>{positionText}</span>
      </p>

      {/* Band şeridi: üstte bugünkü fiyat, altta band sınırları ve seviyeler */}
      <div className="relative mt-9 mb-7 h-3 rounded-full bg-navy-700/60">
        <div
          className="absolute inset-y-0 rounded-full bg-accent/35 ring-1 ring-inset ring-accent/50"
          style={{ left: `${pos(bandLow)}%`, width: `${pos(bandHigh) - pos(bandLow)}%` }}
          title={`Tipik band: ${fmt(bandLow)} – ${fmt(bandHigh)}`}
        />
        {/* Band ortası */}
        <div
          className="absolute inset-y-0 w-px bg-accent"
          style={{ left: `${pos(bandMid)}%` }}
          title={`Band ortası: ${fmt(bandMid)}`}
        />
        {/* Destek ve direnç seviyeleri — şeridin altına taşar */}
        {supports.map((s) => (
          <div
            key={`s-${s.level}`}
            className="absolute -bottom-1.5 h-6 w-0.5 rounded-full bg-gain"
            style={{ left: `${pos(s.level)}%` }}
            title={`Destek ${fmt(s.level)} — ${s.touches} kez dokunuldu`}
          />
        ))}
        {resistances.map((r) => (
          <div
            key={`r-${r.level}`}
            className="absolute -bottom-1.5 h-6 w-0.5 rounded-full bg-loss"
            style={{ left: `${pos(r.level)}%` }}
            title={`Direnç ${fmt(r.level)} — ${r.touches} kez dokunuldu`}
          />
        ))}
        {/* Bugünkü fiyat — şeridin ÜSTÜNDE, alttaki etiketlerle çakışmasın */}
        <div className="absolute -top-8 flex flex-col items-center" style={{ left: `${pos(price)}%` }}>
          <span className="-translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {fmt(price)}
          </span>
          <div className="h-4 w-0.5 -translate-x-1/2 bg-ink" />
        </div>
        {/* Band sınırları */}
        <span
          className="absolute top-5 -translate-x-1/2 whitespace-nowrap text-[10px] tabular-nums text-slate-500"
          style={{ left: `${pos(bandLow)}%` }}
        >
          {fmt(bandLow)}
        </span>
        <span
          className="absolute top-5 -translate-x-1/2 whitespace-nowrap text-[10px] tabular-nums text-slate-500"
          style={{ left: `${pos(bandHigh)}%` }}
        >
          {fmt(bandHigh)}
        </span>
      </div>

      {/* Şeridin okunması için küçük gösterge */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-accent/35 ring-1 ring-inset ring-accent/50" />
          tipik band
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-0.5 rounded-full bg-gain" />
          destek
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-0.5 rounded-full bg-loss" />
          direnç
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-0.5 rounded-full bg-ink" />
          bugünkü fiyat
        </span>
      </div>

      {/* Seviye listesi */}
      <div className="grid gap-3 sm:grid-cols-2">
        <LevelList
          title="Destekler (aşağıda tutabilecek seviyeler)"
          levels={supports}
          fmt={fmt}
          tone="gain"
          emptyText="Fiyatın altında geçmişten kalma belirgin destek yok."
        />
        <LevelList
          title="Dirençler (yukarıda zorlayabilecek seviyeler)"
          levels={resistances}
          fmt={fmt}
          tone="loss"
          emptyText="Fiyatın üzerinde belirgin direnç yok — hisse zirve bölgesinde."
        />
      </div>
    </div>
  );
}

function LevelList({ title, levels, fmt, tone, emptyText }) {
  const toneClass = tone === 'gain' ? 'text-gain' : 'text-loss';
  return (
    <div>
      <p className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-500">{title}</p>
      {levels.length === 0 ? (
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-slate-400">
          <Ban size={12} className="mt-0.5 shrink-0 text-slate-500" />
          {emptyText}
        </p>
      ) : (
        <ul className="space-y-1">
          {levels.map((l) => (
            <li key={l.level} className="flex items-center gap-2 text-xs">
              <Anchor size={12} className={`shrink-0 ${toneClass}`} />
              <span className="font-semibold tabular-nums text-ink">{fmt(l.level)}</span>
              <span className={`tabular-nums ${toneClass}`}>
                {l.distancePct > 0 ? '+' : ''}
                {l.distancePct}%
              </span>
              <span className="ml-auto text-[10px] text-slate-500">{l.touches} dokunuş</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

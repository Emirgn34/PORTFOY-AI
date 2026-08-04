import { ShieldCheck, TrendingUp, Target, AlertTriangle, Ban } from 'lucide-react';
import { formatCurrency } from '../utils/portfolioCalculations.js';
import {
  buildEntryPlan,
  describeLevel,
  getEntryStatusText,
  getBandPositionText,
} from '../utils/priceLevels.js';

/**
 * "Nereden alınır, nerede zorlanır?" kartı.
 *
 * Önceki sürüm seviyeleri ince çizgiler + tooltip olarak gösteriyordu; mobilde
 * tooltip hiç açılmadığı için sayılar görünmez kalıyordu ve "destek/direnç"
 * terimleri açıklanmadan kullanılıyordu. Bu sürümde her seviye ETİKETLİ ve
 * kendi cümlesiyle listelenir: kaç kez test edilmiş, bugünkü fiyata uzaklığı ne.
 */
export default function PriceLevelsCard({ structure, price, currency }) {
  if (!structure || !price) return null;

  const { bandLow, bandHigh, bandMid, supports = [], resistances = [] } = structure;
  const fmt = (v) => formatCurrency(v, currency);
  const plan = buildEntryPlan(structure, price);

  // Şerit ölçeği: tüm seviyeler + band + fiyat sığsın
  const allLevels = [...supports, ...resistances].map((l) => l.level);
  const lo = Math.min(bandLow, price, ...allLevels, plan?.invalidation ?? Infinity);
  const hi = Math.max(bandHigh, price, ...allLevels);
  const pad = (hi - lo || price * 0.05) * 0.12;
  const min = lo - pad;
  const max = hi + pad;
  const pos = (v) => ((v - min) / (max - min)) * 100;

  return (
    <div className="space-y-4">
      {/* 1. Bu hisse normalde nerede geziyor? */}
      <div className="rounded-lg border border-navy-700/60 bg-navy-850 p-4">
        <p className="text-sm leading-relaxed text-slate-300">
          Bu hisse son {structure.bandDays} işlem gününün çoğunu{' '}
          <span className="font-semibold text-ink">
            {fmt(bandLow)} – {fmt(bandHigh)}
          </span>{' '}
          aralığında geçirdi. {getBandPositionText(structure)}
        </p>

        {/* Şerit: bugünkü fiyat üstte, seviyeler altta ETİKETLİ */}
        <div className="relative mt-8 mb-10 h-3 rounded-full bg-navy-700/60">
          <div
            className="absolute inset-y-0 rounded-full bg-accent/30 ring-1 ring-inset ring-accent/40"
            style={{ left: `${pos(bandLow)}%`, width: `${pos(bandHigh) - pos(bandLow)}%` }}
          />
          <div className="absolute inset-y-0 w-px bg-accent/70" style={{ left: `${pos(bandMid)}%` }} />

          {/* Giriş bölgesi — yeşil vurgu */}
          {plan && (
            <div
              className="absolute -inset-y-1 rounded bg-gain/25 ring-1 ring-inset ring-gain/50"
              style={{ left: `${pos(plan.low)}%`, width: `${Math.max(1.5, pos(plan.high) - pos(plan.low))}%` }}
            />
          )}

          {supports.map((s) => (
            <div key={`s-${s.level}`} className="absolute -bottom-1.5" style={{ left: `${pos(s.level)}%` }}>
              <div className="h-6 w-0.5 -translate-x-1/2 rounded-full bg-gain" />
              <span className="mt-0.5 block -translate-x-1/2 whitespace-nowrap text-[10px] font-medium tabular-nums text-gain">
                {fmt(s.level)}
              </span>
            </div>
          ))}
          {resistances.map((r) => (
            <div key={`r-${r.level}`} className="absolute -bottom-1.5" style={{ left: `${pos(r.level)}%` }}>
              <div className="h-6 w-0.5 -translate-x-1/2 rounded-full bg-loss" />
              <span className="mt-0.5 block -translate-x-1/2 whitespace-nowrap text-[10px] font-medium tabular-nums text-loss">
                {fmt(r.level)}
              </span>
            </div>
          ))}

          <div className="absolute -top-8 flex flex-col items-center" style={{ left: `${pos(price)}%` }}>
            <span className="-translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[10px] font-semibold text-white">
              şimdi {fmt(price)}
            </span>
            <div className="h-4 w-0.5 -translate-x-1/2 bg-ink" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
          <Legend className="bg-accent/30 ring-1 ring-inset ring-accent/40" label="normal işlem bandı" wide />
          <Legend className="bg-gain/40 ring-1 ring-inset ring-gain/60" label="alım bölgesi" wide />
          <Legend className="bg-gain" label="alt seviyeler (destek)" />
          <Legend className="bg-loss" label="üst seviyeler (direnç)" />
        </div>
      </div>

      {/* 2. Alım bölgesi + bozulma seviyesi */}
      {plan && (
        <div className="rounded-lg border border-gain/25 bg-gain/5 p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gain">
            <Target size={13} />
            Hangi fiyattan alınabilir?
          </p>
          <p className="mt-2 text-lg font-semibold tabular-nums text-ink">
            {fmt(plan.low)} – {fmt(plan.high)}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">
            {plan.anchorIsSupport
              ? `Bu aralık, geçmişte ${plan.anchorTouches} kez tutmuş olan ${fmt(plan.low)} seviyesinin hemen üstü. ` +
                'Buradan girildiğinde "nerede yanıldığım belli olur" noktası yakındır.'
              : 'Belirgin bir destek seviyesi bulunmadığı için aralık, hissenin normal işlem bandının alt sınırından hesaplandı.'}
          </p>
          <p className="mt-2 text-xs font-medium text-slate-200">{getEntryStatusText(plan)}</p>
          <p className="mt-3 flex items-start gap-1.5 border-t border-gain/20 pt-2.5 text-xs leading-relaxed text-amber-200/90">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />
            <span>
              <span className="font-semibold">{fmt(plan.invalidation)}</span> altına inerse bu kurulum
              bozulur — dayanak seviye kırılmış olur ve fikrin gerekçesi ortadan kalkar.
            </span>
          </p>
        </div>
      )}

      {/* 3. Alt ve üst seviyeler — sade dille */}
      <div className="grid gap-3 sm:grid-cols-2">
        <LevelBlock
          icon={ShieldCheck}
          title="ALT SEVİYELER (destek)"
          subtitle="Fiyat düşerse buralarda tutması beklenir"
          levels={supports}
          kind="support"
          fmt={fmt}
          tone="gain"
          emptyText="Fiyatın altında geçmişten kalma belirgin bir seviye yok — düşüşte tutunacak referans zayıf."
        />
        <LevelBlock
          icon={TrendingUp}
          title="ÜST SEVİYELER (direnç)"
          subtitle="Fiyat yükselirse buralarda zorlanması beklenir"
          levels={resistances}
          kind="resistance"
          fmt={fmt}
          tone="loss"
          emptyText="Fiyatın üzerinde belirgin bir seviye yok — hisse zirve bölgesinde, önü açık."
        />
      </div>
    </div>
  );
}

function Legend({ className, label, wide = false }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`${wide ? 'h-2 w-3' : 'h-3 w-0.5'} rounded-sm ${className}`} />
      {label}
    </span>
  );
}

function LevelBlock({ icon: Icon, title, subtitle, levels, kind, fmt, tone, emptyText }) {
  const toneText = tone === 'gain' ? 'text-gain' : 'text-loss';
  const toneBorder = tone === 'gain' ? 'border-gain/20' : 'border-loss/20';

  return (
    <div className={`rounded-lg border ${toneBorder} bg-navy-850 p-4`}>
      <p className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${toneText}`}>
        <Icon size={13} />
        {title}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>

      {levels.length === 0 ? (
        <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-slate-400">
          <Ban size={12} className="mt-0.5 shrink-0 text-slate-500" />
          {emptyText}
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {levels.map((level) => {
            const d = describeLevel(level, kind);
            return (
              <li key={level.level}>
                <p className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold tabular-nums text-ink">{fmt(level.level)}</span>
                  <span className="text-[11px] text-slate-400">{d.distanceText}</span>
                  <span className={`ml-auto text-[10px] font-medium uppercase ${toneText}`}>
                    {d.confidence}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{d.behaviourText}.</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

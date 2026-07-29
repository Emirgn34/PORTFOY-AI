import { TrendingUp, TrendingDown, MoveRight, Target } from 'lucide-react';
import { formatCurrency } from '../utils/portfolioCalculations.js';

/**
 * "Beklenen performans" kartı.
 *
 * Tek bir tahmin sayısı vermekle yetinmez; o sayıyı üreten sürücüleri
 * (geçmiş benzer grafik, tipik banda dönüş, analist hedefi) ağırlıklarıyla
 * birlikte açar. Amaç, kullanıcının rakamı sorgulayabilmesi: hangi kaynak ne
 * söylüyor, ne kadar ağırlık taşıyor ve kaynaklar hemfikir mi.
 */
export default function ExpectedPerformanceCard({ expectation, price, currency }) {
  if (!expectation) return null;

  const {
    expectedReturnPct,
    expectedPrice,
    rangeLowPct,
    rangeHighPct,
    expectedPriceLow,
    expectedPriceHigh,
    direction,
    confidenceLabel,
    horizonLabel,
    drivers,
  } = expectation;

  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : MoveRight;
  const toneText =
    direction === 'up' ? 'text-gain' : direction === 'down' ? 'text-loss' : 'text-slate-400';
  const confClass =
    confidenceLabel === 'yüksek'
      ? 'border-gain/30 bg-gain/15 text-gain'
      : confidenceLabel === 'orta'
        ? 'border-amber-400/30 bg-amber-400/15 text-amber-400'
        : 'border-loss/30 bg-loss/15 text-loss';

  const fmt = (v) => formatCurrency(v, currency);
  const signed = (v) => `${v > 0 ? '+' : ''}${v}%`;

  // Aralık çubuğu: rangeLow..rangeHigh arasında 0 (bugünkü fiyat) nerede kalıyor
  const span = rangeHighPct - rangeLowPct || 1;
  const zeroPos = Math.max(0, Math.min(100, ((0 - rangeLowPct) / span) * 100));
  const expPos = Math.max(0, Math.min(100, ((expectedReturnPct - rangeLowPct) / span) * 100));

  return (
    <div className="rounded-lg border border-navy-700/60 bg-navy-850 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className={`flex items-center gap-1.5 text-3xl font-bold tabular-nums ${toneText}`}>
          <Icon size={22} />
          {signed(expectedReturnPct)}
        </p>
        <p className="text-sm text-slate-400">
          {horizonLabel} içinde ·{' '}
          <span className="font-semibold text-ink">
            {fmt(price)} → {fmt(expectedPrice)}
          </span>
        </p>
        <span className={`ml-auto rounded-md border px-2 py-0.5 text-[11px] font-semibold ${confClass}`}>
          Sinyal güveni: {confidenceLabel}
        </span>
      </div>

      {/* Olası aralık */}
      <div className="mt-4">
        <div className="relative h-2 rounded-full bg-gradient-to-r from-loss/30 via-navy-700/70 to-gain/30">
          <div
            className="absolute -top-1 h-4 w-px bg-slate-500"
            style={{ left: `${zeroPos}%` }}
            title="Bugünkü fiyat (%0)"
          />
          <div
            className={`absolute -top-1.5 h-5 w-1 rounded-full ${direction === 'down' ? 'bg-loss' : direction === 'up' ? 'bg-gain' : 'bg-slate-400'}`}
            style={{ left: `${expPos}%` }}
            title={`Beklenen: ${signed(expectedReturnPct)}`}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-slate-500">
          <span>
            {signed(rangeLowPct)} ({fmt(expectedPriceLow)})
          </span>
          <span className="text-slate-400">olası aralık</span>
          <span>
            {signed(rangeHighPct)} ({fmt(expectedPriceHigh)})
          </span>
        </div>
      </div>

      {/* Bu beklentinin sebepleri */}
      <p className="mt-4 mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
        <Target size={12} />
        Bu beklenti neye dayanıyor?
      </p>
      <ul className="space-y-2.5">
        {drivers.map((d) => {
          const dTone = d.valuePct > 0 ? 'text-gain' : d.valuePct < 0 ? 'text-loss' : 'text-slate-400';
          return (
            <li key={d.key}>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-ink">{d.label}</span>
                <span className={`font-semibold tabular-nums ${dTone}`}>{signed(d.valuePct)}</span>
                <span className="ml-auto shrink-0 text-[10px] text-slate-500">
                  ağırlık %{d.weightPct}
                </span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-navy-700/70">
                <div className="h-full rounded-full bg-accent/60" style={{ width: `${d.weightPct}%` }} />
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{d.note}</p>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 border-t border-navy-700/60 pt-2 text-[11px] leading-relaxed text-slate-500">
        Bu bir olasılık tahminidir, garanti değildir. Kaynaklar ne kadar hemfikirse ve veri ne
        kadar güçlüyse sinyal güveni o kadar yükselir.
      </p>
    </div>
  );
}

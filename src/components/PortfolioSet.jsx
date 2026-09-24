import { useState } from 'react';
export default function PortfolioSet({ portfolios = [] }) {
  const [slug, setSlug] = useState(null);
  const active = portfolios.find((p) => p.slug === slug) ?? portfolios[0];
  if (!active) return null;
  return <section className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{portfolios.map((p) => <button key={p.slug} onClick={() => setSlug(p.slug)} aria-pressed={p.slug === active.slug} className={`rounded-xl border p-4 text-left ${p.slug === active.slug ? 'border-accent bg-accent/10' : 'border-navy-700 bg-navy-900'}`}>
      <p className="text-xs text-slate-400">Risk {p.riskTier} · {p.riskLabel}</p><h3 className="mt-1 font-semibold text-ink">{p.name}</h3><p className="mt-3 text-xs text-slate-400">{p.holdings.length} hisse · %{p.cashWeightPct} nakit</p>
    </button>)}</div>
    <div className="overflow-hidden rounded-xl border border-navy-700 bg-navy-900">
      <div className="p-4"><h3 className="font-semibold text-ink">{active.name}</h3><p className="mt-1 text-xs text-slate-400">{active.description}</p></div>
      {!active.holdings.length ? <p className="p-5 text-sm text-amber-400">Bu kategori için tüm koşulları karşılayan hisse yok. Sepet nakitte bekliyor.</p>
        : <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-y border-navy-700 text-xs text-slate-500"><tr>{['Hisse','Ağırlık','Analiz fiyatı','Değerleme / kaynak','Seçim'].map((s) => <th className="p-3" key={s}>{s}</th>)}</tr></thead><tbody>{active.holdings.map((h) => <tr key={h.ticker} className="border-b border-navy-800 last:border-0"><td className="p-3"><b className="text-ink">{h.ticker}</b><p className="text-xs text-slate-500">{h.companyName}</p></td><td className="p-3 text-slate-300">%{h.weightPct}</td><td className="p-3 text-slate-300">${Number(h.currentPriceAtGeneration).toFixed(2)}</td><td className="p-3 text-xs text-slate-400">{h.valuation?.discountPct != null ? `%${h.valuation.discountPct} sektör iskontosu` : h.sourceManagers?.join(', ') || '—'}</td><td className="p-3 text-xs text-accent">{h.manual ? 'Manuel seçim' : 'Algoritma'}</td></tr>)}</tbody></table></div>}
      {active.warnings?.length > 0 && <p className="p-4 text-xs text-amber-400">{active.warnings.join(' ')}</p>}
    </div>
  </section>;
}

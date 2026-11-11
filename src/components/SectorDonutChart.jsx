import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { formatCurrency } from '../utils/portfolioCalculations.js';

/**
 * Sektör dağılımı donut grafiği AYRI modüldedir ve PortfolioPage onu lazy()
 * ile yükler: Recharts (~113 kB gzip) yalnızca bu grafik için gerekiyor,
 * portföy sayfasının ilk açılışını bekletmemeli (madde 11).
 */
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

export default function SectorDonutChart({ data, colors }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={50}
          outerRadius={75}
          paddingAngle={3}
          stroke="none"
        >
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Tooltip content={<ChartTooltip />} />
      </PieChart>
    </ResponsiveContainer>
  );
}

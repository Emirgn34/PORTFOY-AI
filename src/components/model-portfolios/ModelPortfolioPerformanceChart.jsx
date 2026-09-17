import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MODEL_PORTFOLIO_BENCHMARKS } from '../../utils/modelPortfolioPerformance.js';

const PORTFOLIO_COLOR_BY_SLUG = Object.freeze({
  'quality-defense': '#22b58a',
  'balanced-growth': '#3b82f6',
  'technology-growth': '#f59e0b',
  'short-momentum': '#ef4444',
});
const PORTFOLIO_COLORS = ['#2f8f5b', '#527fc4', '#d18a2d', '#b65353'];
const BENCHMARK_META = {
  bist100: { label: 'BIST 100', color: '#809087' },
  sp500: { label: 'S&P 500', color: '#8f9ba2' },
  nasdaq: { label: 'NASDAQ', color: '#687fba' },
  gold: { label: 'Altın', color: '#c49a45' },
};

export const PERFORMANCE_RANGES = Object.freeze([
  Object.freeze({ key: '1m', label: '1A', months: 1 }),
  Object.freeze({ key: '3m', label: '3A', months: 3 }),
  Object.freeze({ key: '6m', label: '6A', months: 6 }),
  Object.freeze({ key: 'ytd', label: 'YTD', ytd: true }),
  Object.freeze({ key: '1y', label: '1Y', years: 1 }),
  Object.freeze({ key: 'max', label: 'MAKS', max: true }),
]);

const shortDateFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const longDateFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const percentFormatter = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});

const navFormatter = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function finiteNumber(value) {
  if (value == null || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const multiplier = 10 ** digits;
  const rounded = Math.round((value + Number.EPSILON) * multiplier) / multiplier;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function parseChartDate(value) {
  if (!value) return null;
  const source = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? `${value}T00:00:00.000Z`
    : value;
  const date = new Date(source);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeDate(value) {
  const date = parseChartDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function formatShortDate(value) {
  const date = parseChartDate(value);
  return date ? shortDateFormatter.format(date) : String(value ?? '');
}

function formatLongDate(value) {
  const date = parseChartDate(value);
  return date ? longDateFormatter.format(date) : String(value ?? '');
}

function formatPercent(value) {
  const numeric = finiteNumber(value);
  if (numeric == null) return '—';
  return `${percentFormatter.format(Object.is(numeric, -0) ? 0 : numeric)}%`;
}

function formatAxisPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  const rounded = Math.abs(numeric) >= 10 ? numeric.toFixed(0) : numeric.toFixed(1);
  return `${numeric > 0 ? '+' : ''}${rounded}%`;
}

function benchmarkObject(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function portfolioFactor(row) {
  const returnPct = finiteNumber(row?.return_pct ?? row?.returnPct);
  if (returnPct != null && returnPct > -100) return 1 + returnPct / 100;
  const navValue = finiteNumber(row?.nav_value ?? row?.navValue);
  return navValue != null && navValue > 0 ? navValue / 100 : null;
}

function benchmarkFactor(value) {
  if (value && typeof value === 'object') {
    const returnPct = finiteNumber(value.returnPct ?? value.return_pct ?? value.value);
    if (returnPct != null && returnPct > -100) return 1 + returnPct / 100;
    const indexValue = finiteNumber(value.navValue ?? value.nav_value ?? value.index);
    return indexValue != null && indexValue > 0 ? indexValue / 100 : null;
  }
  const returnPct = finiteNumber(value);
  return returnPct != null && returnPct > -100 ? 1 + returnPct / 100 : null;
}

function versionKeyOf(row) {
  return String(row?.version_key ?? row?.versionKey ?? '').trim();
}

function portfolioVersionKey(portfolio) {
  return String(
    portfolio?.versionKey ?? portfolio?.version_key ?? portfolio?.tracking?.versionKey ?? ''
  ).trim();
}

function buildPortfolioDefinitions(portfolios) {
  const seen = new Set();
  const definitions = [];
  for (const portfolio of Array.isArray(portfolios) ? portfolios : []) {
    const slug = String(portfolio?.slug ?? '').trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    definitions.push({ slug, portfolio, versionKey: portfolioVersionKey(portfolio) });
  }
  return definitions;
}

function resolveRowIdentity(row, definitions, slugByExactVersion, metadataByVersion) {
  const versionKey = versionKeyOf(row);
  const metadata = metadataByVersion.get(versionKey);
  const directSlug = String(row?.slug ?? row?.portfolio_slug ?? row?.portfolioSlug ?? '').trim();
  let slug = directSlug || metadata?.slug || slugByExactVersion.get(versionKey) || '';
  if (!slug) {
    slug = [...definitions]
      .sort((left, right) => right.slug.length - left.slug.length)
      .find((definition) => versionKey.startsWith(`${definition.slug}--`))?.slug ?? '';
  }
  if (!slug) return null;
  const cycleStart = String(
    metadata?.cycleStart ?? row?.cycle_start ?? row?.cycleStart ?? ''
  ).trim();
  const cycleKey = cycleStart || (versionKey.startsWith(`${slug}--`)
    ? versionKey.slice(slug.length + 2)
    : versionKey);
  return {
    slug,
    versionKey: versionKey || `${slug}--${cycleKey}`,
    cycleKey: cycleKey || versionKey,
    cycleStart: cycleStart || null,
  };
}

function preferNewerRow(current, candidate) {
  if (!current) return candidate;
  const currentObserved = String(current?.observed_at ?? current?.observedAt ?? '');
  const candidateObserved = String(candidate?.observed_at ?? candidate?.observedAt ?? '');
  return candidateObserved >= currentObserved ? candidate : current;
}

function stitchVersionGroups(groups, factorFromRow) {
  const usableGroups = groups
    .map((group) => {
      const rows = [...group.rows.values()]
        .map((row) => ({ row, date: normalizeDate(row?.nav_date ?? row?.navDate) }))
        .filter((item) => item.date && factorFromRow(item.row) != null)
        .sort((a, b) => a.date.localeCompare(b.date));
      return {
        ...group,
        rows,
        firstDate: rows[0]?.date ?? null,
        sortDate: normalizeDate(group.cycleStart ?? group.cycleKey) ?? rows[0]?.date ?? null,
      };
    })
    .filter((group) => group.rows.length)
    .sort((a, b) => {
      const dateOrder = String(a.sortDate).localeCompare(String(b.sortDate));
      return dateOrder || String(a.versionKey ?? a.cycleKey).localeCompare(String(b.versionKey ?? b.cycleKey));
    });

  const indexByDate = new Map();
  let chainBase = 100;
  for (const group of usableGroups) {
    let endingIndex = chainBase;
    for (const { row, date } of group.rows) {
      const factor = factorFromRow(row);
      if (factor == null || factor <= 0) continue;
      const indexValue = chainBase * factor;
      if (!Number.isFinite(indexValue) || indexValue <= 0) continue;
      indexByDate.set(date, indexValue);
      endingIndex = indexValue;
    }
    chainBase = endingIndex;
  }
  return { indexByDate, versionCount: usableGroups.length };
}

/**
 * Aylık olarak 100'den yeniden başlayan NAV serilerini tek bir bileşik endekste
 * zincirler. Sonuçtaki yüzdeler, ilk aylık sürümün 100 bazına göredir.
 */
export function buildContinuousPerformanceData(portfolios = [], navRows = [], versions = []) {
  const definitions = buildPortfolioDefinitions(portfolios);
  const metadataByVersion = new Map();
  for (const version of Array.isArray(versions) ? versions : []) {
    const versionKey = versionKeyOf(version);
    const slug = String(version?.slug ?? version?.data?.slug ?? '').trim();
    if (!versionKey || !slug) continue;
    metadataByVersion.set(versionKey, {
      slug,
      cycleStart: version?.cycleStart ?? version?.cycle_start ?? null,
    });
  }
  const slugByExactVersion = new Map(
    [
      ...definitions.filter((item) => item.versionKey).map((item) => [item.versionKey, item.slug]),
      ...[...metadataByVersion].map(([versionKey, metadata]) => [versionKey, metadata.slug]),
    ]
  );
  const portfolioGroups = new Map(definitions.map((item) => [item.slug, new Map()]));
  const benchmarkCycles = new Map();

  for (const row of Array.isArray(navRows) ? navRows : []) {
    const identity = resolveRowIdentity(row, definitions, slugByExactVersion, metadataByVersion);
    const date = normalizeDate(row?.nav_date ?? row?.navDate);
    if (!identity || !date) continue;

    const groupsForSlug = portfolioGroups.get(identity.slug);
    if (!groupsForSlug) continue;
    const group = groupsForSlug.get(identity.versionKey) ?? {
      versionKey: identity.versionKey,
      cycleKey: identity.cycleKey,
      cycleStart: identity.cycleStart,
      rows: new Map(),
    };
    group.rows.set(date, preferNewerRow(group.rows.get(date), row));
    groupsForSlug.set(identity.versionKey, group);

    const cycle = benchmarkCycles.get(identity.cycleKey) ?? {
      cycleKey: identity.cycleKey,
      versionKey: identity.cycleKey,
      rows: new Map(),
    };
    const existing = cycle.rows.get(date) ?? {
      nav_date: date,
      benchmarks: {},
      observed_at: '',
      _observedByKey: {},
    };
    const candidateBenchmarks = benchmarkObject(row?.benchmarks);
    if (candidateBenchmarks) {
      const merged = { ...existing.benchmarks };
      const observedByKey = { ...existing._observedByKey };
      const candidateObserved = String(row?.observed_at ?? row?.observedAt ?? '');
      for (const { key } of MODEL_PORTFOLIO_BENCHMARKS) {
        if (
          benchmarkFactor(candidateBenchmarks[key]) != null &&
          candidateObserved >= String(observedByKey[key] ?? '')
        ) {
          merged[key] = candidateBenchmarks[key];
          observedByKey[key] = candidateObserved;
        }
      }
      cycle.rows.set(date, {
        nav_date: date,
        observed_at:
          candidateObserved >= String(existing.observed_at ?? '')
            ? candidateObserved
            : existing.observed_at,
        benchmarks: merged,
        _observedByKey: observedByKey,
      });
    }
    benchmarkCycles.set(identity.cycleKey, cycle);
  }

  const rowsByDate = new Map();
  const versionCounts = {};
  for (const definition of definitions) {
    const groups = [...(portfolioGroups.get(definition.slug)?.values() ?? [])];
    const stitched = stitchVersionGroups(groups, portfolioFactor);
    versionCounts[definition.slug] = stitched.versionCount;
    for (const [date, indexValue] of stitched.indexByDate) {
      const chartRow = rowsByDate.get(date) ?? { date };
      chartRow[definition.slug] = round((indexValue / 100 - 1) * 100);
      rowsByDate.set(date, chartRow);
    }
  }

  for (const { key } of MODEL_PORTFOLIO_BENCHMARKS) {
    const groups = [...benchmarkCycles.values()];
    const stitched = stitchVersionGroups(groups, (row) =>
      benchmarkFactor(benchmarkObject(row?.benchmarks)?.[key])
    );
    versionCounts[key] = stitched.versionCount;
    for (const [date, indexValue] of stitched.indexByDate) {
      const chartRow = rowsByDate.get(date) ?? { date };
      chartRow[key] = round((indexValue / 100 - 1) * 100);
      rowsByDate.set(date, chartRow);
    }
  }

  const data = [...rowsByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const startDates = {};
  for (const definition of definitions) {
    const metadataStarts = [...metadataByVersion.values()]
      .filter((metadata) => metadata.slug === definition.slug)
      .map((metadata) => normalizeDate(metadata.cycleStart))
      .filter(Boolean)
      .sort();
    const portfolioStart = normalizeDate(
      definition.portfolio?.cycleStart ?? definition.portfolio?.cycle_start
    );
    const firstPoint = data.find((row) => finiteNumber(row?.[definition.slug]) != null)?.date ?? null;
    startDates[definition.slug] = metadataStarts[0] ?? portfolioStart ?? firstPoint;
  }

  return {
    data,
    versionCounts,
    startDates,
  };
}

function daysInUtcMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function shiftUtcMonths(date, amount) {
  const monthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() + amount;
  const year = Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const day = Math.min(date.getUTCDate(), daysInUtcMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

function rangeCutoff(latestDate, rangeKey) {
  const option = PERFORMANCE_RANGES.find((item) => item.key === rangeKey) ?? PERFORMANCE_RANGES[2];
  if (option.max) return null;
  if (option.ytd) return new Date(Date.UTC(latestDate.getUTCFullYear(), 0, 1));
  if (option.months) return shiftUtcMonths(latestDate, -option.months);
  if (option.years) return shiftUtcMonths(latestDate, -option.years * 12);
  return null;
}

/** Filtreyi son gerçek NAV tarihine göre uygular; takvim bugünü kullanılmaz. */
export function filterPerformanceRange(data = [], rangeKey = '6m', versionCounts = {}) {
  if (!Array.isArray(data) || !data.length) return [];
  const latestDate = parseChartDate(data[data.length - 1]?.date);
  if (!latestDate) return [];
  const cutoff = rangeCutoff(latestDate, rangeKey);
  const filtered = cutoff
    ? data.filter((row) => {
        const date = parseChartDate(row?.date);
        return date && date >= cutoff;
      })
    : [...data];
  if (!filtered.length || !cutoff || filtered[0] === data[0]) return filtered;

  // Aralık getirisi, yalnızca kesim tarihinde veya öncesinde gerçekten kayıtlı
  // bir değer varsa o değere göre yeniden bazlanır. Bir seri daha sonra başladıysa
  // bilinmeyen geçmişi 0 kabul etmeyiz; mevcut bileşik değeri aynen koruruz.
  const keys = new Set(Object.keys(versionCounts));
  for (const row of data) {
    for (const key of Object.keys(row ?? {})) {
      if (key !== 'date') keys.add(key);
    }
  }
  const baselineRows = {};
  for (const row of data) {
    const date = parseChartDate(row?.date);
    if (!date || date > cutoff) break;
    for (const key of keys) {
      if (finiteNumber(row?.[key]) != null) baselineRows[key] = row[key];
    }
  }
  if (!Object.keys(baselineRows).length) return filtered;
  return filtered.map((row) => {
    const normalized = { ...row };
    for (const key of keys) {
      const value = finiteNumber(row?.[key]);
      const baseline = finiteNumber(baselineRows[key]);
      if (value == null) continue;
      // Seçilen aralığın başlangıcında henüz var olmayan seri,
      // başlangıçtan-getirisi 1Y/6A getirisiymiş gibi yan yana gösterilmez.
      if (baseline == null) {
        normalized[key] = null;
        continue;
      }
      if (baseline <= -100) continue;
      normalized[key] = round(((1 + value / 100) / (1 + baseline / 100) - 1) * 100);
    }
    return normalized;
  });
}

/**
 * Farklı tarihlerde başlamış serileri aynı ilk ortak güne getirir. Bir serinin
 * ortak başlangıçta gerçek baz değeri yoksa onu sıfırdan başlamış gibi
 * uydurmak yerine bu karşılaştırma penceresinde boş bırakır.
 */
export function rebasePerformanceWindow(data = [], startDate = null) {
  const cutoff = parseChartDate(startDate);
  if (!Array.isArray(data) || !data.length || !cutoff) return [...(data ?? [])];
  const filtered = data.filter((row) => {
    const date = parseChartDate(row?.date);
    return date && date >= cutoff;
  });
  if (!filtered.length) return [];

  const keys = new Set();
  const baselines = {};
  for (const row of data) {
    const date = parseChartDate(row?.date);
    for (const [key, raw] of Object.entries(row ?? {})) {
      if (key === 'date') continue;
      keys.add(key);
      if (date && date <= cutoff && finiteNumber(raw) != null) baselines[key] = raw;
    }
  }
  return filtered.map((row) => {
    const normalized = { ...row };
    for (const key of keys) {
      const value = finiteNumber(row?.[key]);
      const baseline = finiteNumber(baselines[key]);
      if (value == null) continue;
      if (baseline == null || baseline <= -100) {
        normalized[key] = null;
        continue;
      }
      normalized[key] = round(((1 + value / 100) / (1 + baseline / 100) - 1) * 100);
    }
    return normalized;
  });
}

function returnSince(points, latestPoint, cutoff) {
  if (!points.length || !latestPoint || !cutoff) return null;
  if (parseChartDate(points[0].date) > cutoff) return null;
  let baseline = null;
  for (const point of points) {
    if (parseChartDate(point.date) <= cutoff) baseline = point;
    else break;
  }
  if (!baseline || baseline.indexValue <= 0) return null;
  return round((latestPoint.indexValue / baseline.indexValue - 1) * 100);
}

/** Gerçek NAV noktalarından performans detay tablosunun metriklerini üretir. */
export function buildPerformanceDetails(portfolios = [], continuousData = [], startDates = {}) {
  const definitions = buildPortfolioDefinitions(portfolios);
  return definitions.map(({ slug, portfolio }) => {
    const points = continuousData
      .map((row) => {
        const value = finiteNumber(row?.[slug]);
        return value == null
          ? null
          : { date: row.date, returnPct: value, indexValue: 100 * (1 + value / 100) };
      })
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date));
    const latest = points[points.length - 1] ?? null;
    const latestDate = parseChartDate(latest?.date);
    const dayCutoff = latestDate ? new Date(latestDate.getTime() - 24 * 60 * 60 * 1000) : null;
    const weekCutoff = latestDate ? new Date(latestDate.getTime() - 7 * 24 * 60 * 60 * 1000) : null;

    return {
      slug,
      name: portfolio?.shortName ?? portfolio?.name ?? slug,
      startDate: normalizeDate(startDates?.[slug]) ?? points[0]?.date ?? null,
      riskScore: finiteNumber(portfolio?.riskScore),
      riskTier: finiteNumber(portfolio?.riskTier ?? portfolio?.risk_tier),
      latestNav: latest ? round(latest.indexValue) : null,
      daily: returnSince(points, latest, dayCutoff),
      weekly: returnSince(points, latest, weekCutoff),
      month1: returnSince(points, latest, latestDate ? shiftUtcMonths(latestDate, -1) : null),
      month3: returnSince(points, latest, latestDate ? shiftUtcMonths(latestDate, -3) : null),
      month6: returnSince(points, latest, latestDate ? shiftUtcMonths(latestDate, -6) : null),
      year1: returnSince(points, latest, latestDate ? shiftUtcMonths(latestDate, -12) : null),
      total: latest?.returnPct ?? null,
    };
  });
}

function metricClass(value) {
  const numeric = finiteNumber(value);
  if (numeric == null || numeric === 0) return 'text-slate-400';
  return numeric > 0 ? 'text-gain' : 'text-loss';
}

function riskClass(riskTier) {
  if (riskTier === 1) return 'border-gain/30 bg-gain/10 text-gain';
  if (riskTier === 2) return 'border-amber-400/30 bg-amber-400/10 text-amber-400';
  return 'border-loss/30 bg-loss/10 text-loss';
}

function PerformanceTooltip({ active, label, payload, seriesMeta }) {
  if (!active || !payload?.length) return null;
  const values = payload.filter((item) => finiteNumber(item.value) != null);
  if (!values.length) return null;

  return (
    <div className="shadow-pop min-w-44 rounded-lg border border-navy-700 bg-navy-900 px-3 py-2.5 text-xs">
      <p className="mb-2 font-semibold text-ink">{formatLongDate(label)}</p>
      <div className="space-y-1.5">
        {values.map((item) => {
          const key = String(item.dataKey ?? item.name ?? '');
          const meta = seriesMeta[key] ?? {};
          return (
            <div key={key} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: meta.color ?? item.color }}
              />
              <span className="min-w-0 flex-1 truncate text-slate-400">
                {meta.label ?? item.name}
              </span>
              <span className={`font-semibold tabular-nums ${metricClass(item.value)}`}>
                {formatPercent(item.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ModelPortfolioPerformanceChart({
  portfolios = [],
  versions = [],
  navRows = [],
  activeSlug,
  trackingStarted = false,
  trackingLoading = false,
  trackingError = null,
}) {
  const [visibleBenchmarks, setVisibleBenchmarks] = useState(() => new Set(['bist100']));
  const [rangeKey, setRangeKey] = useState('6m');
  const [query, setQuery] = useState('');
  const continuous = useMemo(
    () => buildContinuousPerformanceData(portfolios, navRows, versions),
    [portfolios, navRows, versions]
  );
  const portfolioKeys = useMemo(
    () => [...new Set(portfolios.map((portfolio) => String(portfolio?.slug ?? '').trim()).filter(Boolean))],
    [portfolios]
  );
  const comparableEndDate = useMemo(() => {
    for (let index = continuous.data.length - 1; index >= 0; index -= 1) {
      const row = continuous.data[index];
      if (portfolioKeys.length && portfolioKeys.every((key) => finiteNumber(row?.[key]) != null)) {
        return row.date;
      }
    }
    return null;
  }, [continuous.data, portfolioKeys]);
  const comparableData = useMemo(
    () =>
      comparableEndDate
        ? continuous.data.filter((row) => String(row.date) <= comparableEndDate)
        : [],
    [comparableEndDate, continuous.data]
  );
  const details = useMemo(
    () => buildPerformanceDetails(portfolios, comparableData, continuous.startDates),
    [comparableData, continuous.startDates, portfolios]
  );
  const availableFrom = useMemo(() => {
    const starts = Object.values(continuous.startDates ?? {}).filter(Boolean).sort();
    return starts[0] ?? continuous.data[0]?.date ?? null;
  }, [continuous.data, continuous.startDates]);
  const comparableFrom = useMemo(() => {
    const starts = portfolioKeys
      .map((key) => continuous.startDates?.[key])
      .filter(Boolean)
      .sort();
    return starts.at(-1) ?? availableFrom;
  }, [availableFrom, continuous.startDates, portfolioKeys]);
  const commonWindowData = useMemo(
    () => rebasePerformanceWindow(comparableData, comparableFrom),
    [comparableData, comparableFrom]
  );
  const chartData = useMemo(
    () => filterPerformanceRange(commonWindowData, rangeKey, continuous.versionCounts),
    [commonWindowData, continuous.versionCounts, rangeKey]
  );
  const availableTo = comparableEndDate;
  const rangeAvailability = useMemo(
    () =>
      Object.fromEntries(
        PERFORMANCE_RANGES.map((range) => {
          if (range.max) return [range.key, true];
          const start = parseChartDate(comparableFrom);
          const end = parseChartDate(availableTo);
          const cutoff = end ? rangeCutoff(end, range.key) : null;
          return [range.key, Boolean(start && cutoff && start <= cutoff)];
        })
      ),
    [availableTo, comparableFrom]
  );

  useEffect(() => {
    if (!rangeAvailability[rangeKey]) setRangeKey('max');
  }, [rangeAvailability, rangeKey]);

  const portfolioSeries = useMemo(() => {
    const seen = new Set();
    const uniquePortfolios = [];
    for (const portfolio of Array.isArray(portfolios) ? portfolios : []) {
      const slug = String(portfolio?.slug ?? '').trim();
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      uniquePortfolios.push(portfolio);
    }

    return uniquePortfolios.map((portfolio, index) => {
      const key = String(portfolio.slug).trim();
      const isActive = key === activeSlug;
      const color = PORTFOLIO_COLOR_BY_SLUG[key] ?? PORTFOLIO_COLORS[index % PORTFOLIO_COLORS.length];
      return {
        key,
        label: portfolio.shortName ?? portfolio.name ?? key,
        color,
        isActive,
      };
    });
  }, [activeSlug, portfolios]);

  const benchmarkSeries = useMemo(
    () =>
      MODEL_PORTFOLIO_BENCHMARKS.map(({ key, label }) => ({
        key,
        label: BENCHMARK_META[key]?.label ?? label,
        color: BENCHMARK_META[key]?.color ?? '#809087',
      })),
    []
  );

  const seriesMeta = useMemo(
    () =>
      Object.fromEntries(
        [...portfolioSeries, ...benchmarkSeries].map((series) => [series.key, series])
      ),
    [benchmarkSeries, portfolioSeries]
  );

  const renderable = chartData.length >= 2;
  const orderedPortfolioLines = [
    ...portfolioSeries.filter((series) => !series.isActive),
    ...portfolioSeries.filter((series) => series.isActive),
  ];
  const filteredDetails = details.filter((item) =>
    item.name.toLocaleLowerCase('tr-TR').includes(query.trim().toLocaleLowerCase('tr-TR'))
  );

  function toggleBenchmark(key) {
    setVisibleBenchmarks((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const summary = [
    ...portfolioSeries,
    ...benchmarkSeries.filter((item) => visibleBenchmarks.has(item.key)),
  ]
    .map((series) => `${series.label}: ${formatPercent(finiteNumber(chartData.at(-1)?.[series.key]))}`)
    .join(', ');
  return (
    <div className="space-y-4">
      <section
        className="rounded-xl border border-navy-700 bg-navy-900"
        aria-label="Portföy getiri karşılaştırması"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-navy-700 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">Portföy Getiri Karşılaştırması</h3>
            <p className="mt-1 text-xs text-slate-500">
              Kümülatif TL bazlı fiyat getirisi, temettü hariç · aylık sürümler bileşik olarak zincirlenir
            </p>
            {comparableFrom && availableTo && (
              <p className="mt-1 text-[11px] text-slate-500">
                Ortak karşılaştırma dönemi: {formatShortDate(comparableFrom)} – {formatShortDate(availableTo)}
                {' · '}sonuçlar {formatShortDate(availableTo)} ortak değerleme tarihine hizalı
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div
              className="flex max-w-full flex-wrap items-center justify-end gap-1.5"
              role="group"
              aria-label="Karşılaştırma ölçütleri"
            >
              <span className="mr-1 text-[11px] font-medium text-slate-500">
                Benchmark (TL):
              </span>
              {benchmarkSeries.map((benchmark) => {
                const pressed = visibleBenchmarks.has(benchmark.key);
                return (
                  <button
                    key={benchmark.key}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => toggleBenchmark(benchmark.key)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                      pressed
                        ? 'border-accent/30 bg-accent/10 text-accent-soft'
                        : 'border-navy-700 bg-navy-900 text-slate-500 hover:bg-navy-850 hover:text-slate-300'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: benchmark.color }}
                    />
                    {benchmark.label}
                  </button>
                );
              })}
            </div>

            <div
              className="flex items-center justify-end gap-1 rounded-lg border border-navy-700 bg-navy-850/60 p-1"
              role="group"
              aria-label="Performans aralığı"
            >
              {PERFORMANCE_RANGES.map((range) => {
                const available = rangeAvailability[range.key];
                return (
                  <button
                    key={range.key}
                    type="button"
                    aria-pressed={rangeKey === range.key}
                    disabled={!available}
                    title={available ? undefined : 'Bu aralık için henüz yeterli takip geçmişi yok'}
                    onClick={() => setRangeKey(range.key)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      rangeKey === range.key
                        ? 'bg-navy-700 text-ink'
                        : available
                          ? 'text-slate-500 hover:text-slate-300'
                          : 'cursor-not-allowed text-slate-700'
                    }`}
                  >
                    {range.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-5">
          {renderable ? (
            <div
              className="h-80 w-full"
              role="img"
              aria-label={`TL bazlı kümülatif getiri çizgi grafiği. Son değerler: ${summary}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#28322d" strokeDasharray="3 4" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatShortDate}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={28}
                    tick={{ fill: '#828a82', fontSize: 11 }}
                  />
                  <YAxis
                    width={54}
                    domain={[
                      (dataMin) => Math.min(0, Number.isFinite(dataMin) ? dataMin : 0),
                      (dataMax) => Math.max(0, Number.isFinite(dataMax) ? dataMax : 0),
                    ]}
                    tickFormatter={formatAxisPercent}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#828a82', fontSize: 11 }}
                  />
                  <ReferenceLine y={0} stroke="#566159" strokeWidth={1.25} />
                  <Tooltip
                    cursor={{ stroke: '#566159', strokeDasharray: '3 3' }}
                    content={<PerformanceTooltip seriesMeta={seriesMeta} />}
                  />

                  {benchmarkSeries
                    .filter((benchmark) => visibleBenchmarks.has(benchmark.key))
                    .map((benchmark) => (
                      <Line
                        key={benchmark.key}
                        type="monotone"
                        dataKey={benchmark.key}
                        name={benchmark.label}
                        stroke={benchmark.color}
                        strokeWidth={1.35}
                        strokeDasharray="5 4"
                        dot={false}
                        activeDot={{ r: 3 }}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    ))}

                  {orderedPortfolioLines.map((portfolio) => (
                    <Line
                      key={portfolio.key}
                      type="monotone"
                      dataKey={portfolio.key}
                      name={portfolio.label}
                      stroke={portfolio.color}
                      strokeWidth={portfolio.isActive ? 3 : 2}
                      dot={false}
                      activeDot={{ r: portfolio.isActive ? 4 : 3 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div
              className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-navy-700 bg-navy-850/60 px-6 text-center"
              role="status"
            >
              <div>
                <p className="text-sm font-medium text-slate-300">
                  {trackingError
                    ? 'Performans geçmişi şu an okunamadı.'
                    : trackingLoading
                      ? 'Performans geçmişi yükleniyor…'
                      : trackingStarted
                        ? 'Takip başladı; ilk kapanış verisi bekleniyor.'
                        : 'Performans takibi henüz başlamadı.'}
                </p>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                  {trackingError
                    ? 'Güncel sepetler kullanılabilir; geçmiş veriyi daha sonra yeniden deneyin.'
                    : trackingLoading
                      ? 'Güncel sepet gösterilirken aylık sürümler ve NAV kayıtları arka planda okunuyor.'
                      : 'Karşılaştırma grafiği, en az iki tarihli gerçek kapanış kaydı oluştuğunda gösterilir.'}
                </p>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Model portföylerin son getirileri">
            {portfolioSeries.map((portfolio) => {
              const value = finiteNumber(chartData.at(-1)?.[portfolio.key]);
              return (
                <div
                  key={portfolio.key}
                  className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                    portfolio.isActive
                      ? 'border-accent/30 bg-accent/5 text-ink'
                      : 'border-navy-700 bg-navy-850/60 text-slate-400'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: portfolio.color }}
                  />
                  <span className="font-medium">{portfolio.label}</span>
                  <span className={`font-semibold tabular-nums ${metricClass(value)}`}>
                    {formatPercent(value)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-navy-700 bg-navy-900" aria-labelledby="performance-details-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-700 px-5 py-4">
          <div>
            <h3 id="performance-details-title" className="text-sm font-semibold text-ink">
              Performans Detayları
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              TL bazlı fiyat getirisi, temettü hariç. Bildirilen split/bedelsiz oranları düzeltilir; yalnızca birikmiş gerçek NAV kayıtları hesaplamaya katılır.
            </p>
          </div>
          <label className="sr-only" htmlFor="model-portfolio-performance-search">
            Portföy ara
          </label>
          <input
            id="model-portfolio-performance-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Portföy ara"
            className="w-48 rounded-lg border border-navy-700 bg-navy-850 px-3 py-2 text-xs text-ink outline-none placeholder:text-slate-500 focus:border-accent"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-xs">
            <thead className="border-b border-navy-700 text-left uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Başlangıç</th>
                <th className="px-4 py-3 font-medium">Portföy</th>
                <th className="px-3 py-3 text-center font-medium">Risk</th>
                <th className="px-3 py-3 text-right font-medium">Son NAV</th>
                <th className="px-3 py-3 text-right font-medium">Günlük</th>
                <th className="px-3 py-3 text-right font-medium">Haftalık</th>
                <th className="px-3 py-3 text-right font-medium">1 Aylık</th>
                <th className="px-3 py-3 text-right font-medium">3 Aylık</th>
                <th className="px-3 py-3 text-right font-medium">6 Aylık</th>
                <th className="px-3 py-3 text-right font-medium">1 Yıllık</th>
                <th className="px-4 py-3 text-right font-medium">Takip Başından</th>
              </tr>
            </thead>
            <tbody>
              {filteredDetails.map((item) => {
                const riskDisplay = item.riskScore ?? item.riskTier;
                return (
                  <tr
                    key={item.slug}
                    className={`border-b border-navy-800 last:border-0 ${
                      item.slug === activeSlug ? 'bg-accent/5' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-300">
                      {item.startDate ? formatLongDate(item.startDate) : '—'}
                    </td>
                    <td className="px-4 py-3 font-semibold text-accent-soft">{item.name}</td>
                    <td className="px-3 py-3 text-center">
                      {riskDisplay == null ? (
                        '—'
                      ) : (
                        <span className={`inline-flex min-w-7 justify-center rounded-full border px-2 py-1 font-semibold ${riskClass(item.riskTier)}`}>
                          {item.riskScore ?? `${item.riskTier}/4`}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">
                      {item.latestNav == null ? '—' : navFormatter.format(item.latestNav)}
                    </td>
                    {['daily', 'weekly', 'month1', 'month3', 'month6', 'year1', 'total'].map((key) => (
                      <td key={key} className={`px-3 py-3 text-right font-semibold tabular-nums ${metricClass(item[key])}`}>
                        {formatPercent(item[key])}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {!filteredDetails.length && (
                <tr>
                  <td colSpan={11} className="px-5 py-10 text-center text-sm text-slate-500">
                    Aramayla eşleşen portföy bulunamadı.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

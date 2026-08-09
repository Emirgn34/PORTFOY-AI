import { scoreAndRankCandidates } from '../src/utils/opportunityScoringCore.js';

function marketOf(row) {
  if (row?.market === 'BIST' || String(row?.symbol ?? '').endsWith('.IS')) return 'BIST';
  return 'US';
}

function rankedRows(rows, horizon, referenceMs) {
  const relevant = rows.filter((row) => row.horizon === horizon && row?.data);
  const byTicker = new Map(relevant.map((row) => [row.data.symbol, row]));
  return scoreAndRankCandidates(
    relevant.map((row) => row.data),
    horizon,
    referenceMs
  )
    .map((candidate) => byTicker.get(candidate.symbol))
    .filter(Boolean);
}

/**
 * Global sıralamanın BIST'i ABD havuzu içinde eritmesini önleyen seçim.
 * Her pazar kendi içinde sıralanır; bir pazarda yeterli aday yoksa boş kontenjan
 * diğer pazarın sıradaki adaylarıyla doldurulur.
 */
export function selectMarketBalancedSymbols(
  rows,
  horizon,
  { total = 100, bistShare = 0.45, referenceMs = Date.now() } = {}
) {
  const ranked = rankedRows(rows, horizon, referenceMs);
  const bist = ranked.filter((row) => marketOf(row) === 'BIST');
  const us = ranked.filter((row) => marketOf(row) === 'US');
  const bistTarget = Math.round(total * bistShare);
  const usTarget = Math.max(0, total - bistTarget);

  const selected = [...bist.slice(0, bistTarget), ...us.slice(0, usTarget)];
  const selectedSymbols = new Set(selected.map((row) => row.symbol));

  if (selected.length < total) {
    for (const row of ranked) {
      if (selected.length >= total) break;
      if (selectedSymbols.has(row.symbol)) continue;
      selected.push(row);
      selectedSymbols.add(row.symbol);
    }
  }

  return selected.map((row) => row.symbol);
}

/** Yeni jenerasyonun geçici veri sağlayıcı hatasıyla küçülmesini önler. */
export function assessGenerationCompleteness(
  plannedSymbols,
  candidateRows,
  { minimumOverall = 0.65, minimumPerMarket = 0.55 } = {}
) {
  const planned = [...new Set(plannedSymbols)];
  const completed = new Set((candidateRows ?? []).map((row) => row.symbol));
  const ratio = planned.length > 0 ? completed.size / planned.length : 0;
  const markets = ['BIST', 'US'].map((market) => {
    const isMarket = (symbol) => (String(symbol).endsWith('.IS') ? 'BIST' : 'US') === market;
    const expected = planned.filter(isMarket).length;
    const actual = [...completed].filter(isMarket).length;
    return { market, expected, actual, ratio: expected > 0 ? actual / expected : 1 };
  });
  const ok = ratio >= minimumOverall && markets.every((item) => item.ratio >= minimumPerMarket);
  return { ok, expected: planned.length, actual: completed.size, ratio, markets };
}


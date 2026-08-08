export const TRADING_WINDOWS = { short: 20, long: 252 };

export function closeOnOrBefore(closes, targetMs) {
  let found = null;
  for (const quote of closes) {
    if (quote.t <= targetMs) found = quote;
    else break;
  }
  return found;
}

export function forwardTradingClose(closes, capturedMs, tradingSessions) {
  if (!closes.length || tradingSessions <= 0) return null;
  const firstFutureIndex = closes.findIndex((quote) => quote.t > capturedMs);
  if (firstFutureIndex < 0) return null;
  return closes[firstFutureIndex + tradingSessions - 1] ?? null;
}

export const mean = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function sampleStdDev(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function summarizeReturns(grossReturns, excessReturns, roundTripCostBps = 0) {
  const cost = Math.max(0, Number(roundTripCostBps) || 0) / 10_000;
  const netReturns = grossReturns.map((value) => value - cost);
  const netExcess = excessReturns.map((value) => value - cost);
  const excessStd = sampleStdDev(netExcess);
  return {
    count: grossReturns.length,
    grossMean: mean(grossReturns),
    netMean: mean(netReturns),
    medianNet: median(netReturns),
    hitRateNet: netReturns.length
      ? netReturns.filter((value) => value > 0).length / netReturns.length
      : 0,
    excessMeanNet: mean(netExcess),
    excessTStat:
      netExcess.length > 1 && excessStd > 0
        ? mean(netExcess) / (excessStd / Math.sqrt(netExcess.length))
        : null,
  };
}

export function dedupeSignalEpisodes(snapshots) {
  const byEpisode = new Map();
  for (const snapshot of snapshots) {
    const date = String(snapshot.captured_at ?? '').slice(0, 10);
    const key = snapshot.signal_key || `${date}:${snapshot.market}:${snapshot.symbol}:${snapshot.horizon}`;
    const previous = byEpisode.get(key);
    if (!previous || new Date(snapshot.captured_at) < new Date(previous.captured_at)) {
      byEpisode.set(key, snapshot);
    }
  }
  return [...byEpisode.values()].sort(
    (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime()
  );
}

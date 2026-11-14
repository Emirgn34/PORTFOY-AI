// Strategy bars use the opening timestamp of a completed one-minute candle.
// Recheck saved observations on every API read and every client clock tick.
export function currentVideoStrategies(strategies, now = Date.now()) {
  if (!Array.isArray(strategies)) return strategies;
  return strategies.map((strategy) => {
    const close = Date.parse(strategy.lastBarTime) + 60_000;
    const verified = Number.isFinite(now) && Number.isFinite(close) && close <= now && now - close <= 300_000;
    if (verified || strategy.dataStatus === 'insufficient') return strategy;
    const reason = 'Güncel mum zamanı doğrulanamıyor; gösterilen seviyeler geçmiş araştırma bağlamıdır.';
    return { ...strategy, patternState: strategy.patternState ?? strategy.state, state: 'waiting', dataStatus: 'stale', actionable: false,
      reasons: [reason, ...(strategy.reasons ?? []).filter((value) => value !== reason)],
      setups: strategy.setups?.map((setup) => ({ ...setup, patternState: setup.patternState ?? setup.state, state: 'waiting' })),
    };
  });
}

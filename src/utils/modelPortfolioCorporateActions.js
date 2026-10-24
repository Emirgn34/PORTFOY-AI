// Only completed, source-verified cash acquisitions belong here. A missing
// quote alone must never be treated as a sale or a zero-return holding.
export const MODEL_PORTFOLIO_CASH_ACQUISITIONS = Object.freeze({
  WBD: Object.freeze({
    effectiveAt: '2026-10-06T13:30:00.000Z',
    currency: 'USD',
    cashPerShare: 31.01666668,
    source: 'https://www.nasdaqtrader.com/TraderNews.aspx?id=ECA2026-710',
  }),
});

export function getModelPortfolioCashAcquisition(symbol, startedAt, observedAt) {
  const action = MODEL_PORTFOLIO_CASH_ACQUISITIONS[symbol];
  if (!action || !startedAt || !observedAt) return null;
  const start = Date.parse(startedAt);
  const observed = Date.parse(observedAt);
  const effective = Date.parse(action.effectiveAt);
  return Number.isFinite(start) && Number.isFinite(observed) &&
    start < effective && observed >= effective ? action : null;
}

/** Risk sizing for a user-entered cash budget; no order is placed. */
export function calculateNewsPosition({ capital, riskPercent, allocationPercent, entry, stop, costBps = 20 }) {
  const numbers = [capital, riskPercent, allocationPercent, entry, stop, costBps].map(Number);
  const [budget, risk, cap, price, lossPrice, costs] = numbers;
  if (numbers.some((n) => !Number.isFinite(n)) || budget <= 0 || risk <= 0 || risk > 5 || cap <= 0 || cap > 100 ||
    price <= 0 || lossPrice <= 0 || lossPrice >= price || costs < 0 || costs > 1000) return null;
  const fees = price * costs / 10000;
  const perShareRisk = price - lossPrice + fees;
  const units = Math.max(0, Math.floor(Math.min(budget * risk / 100 / perShareRisk, budget * cap / 100 / (price + fees))));
  return { units, positionValue: units * price, budgetUsed: units * (price + fees), estimatedLoss: units * perShareRisk,
    allocationPercent: units * (price + fees) / budget * 100, riskBudget: budget * risk / 100 };
}

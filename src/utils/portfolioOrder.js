/** Move whole records by ID, retaining the latest prices and all other fields. */
export function movePortfolioStock(stocks, activeId, overId) {
  const from = stocks.findIndex((stock) => stock.id === activeId);
  const to = stocks.findIndex((stock) => stock.id === overId);
  if (from < 0 || to < 0 || from === to) return stocks;
  const next = [...stocks];
  const [stock] = next.splice(from, 1);
  next.splice(to, 0, stock);
  return next;
}

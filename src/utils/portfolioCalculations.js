/**
 * Portföy hesaplama yardımcıları.
 * Döviz kurları varsayılan değerlerle başlar; canlı veri sunucusu
 * çalışıyorsa updateExchangeRates() ile gerçek kurlara güncellenir
 * (son bilinen kur localStorage'da saklanır, çevrimdışı açılışta kullanılır).
 */
export const EXCHANGE_RATES_TO_TRY = {
  TRY: 1,
  USD: 43.5,
  EUR: 47.2,
};

const FX_STORAGE_KEY = 'portfoyai_fx_rates';

// Açılışta son bilinen canlı kurlar varsa onları kullan
try {
  const stored = JSON.parse(window.localStorage.getItem(FX_STORAGE_KEY));
  if (stored?.USD) Object.assign(EXCHANGE_RATES_TO_TRY, stored);
} catch {
  // localStorage erişilemezse varsayılanlarla devam et
}

/** Canlı FX verisi geldiğinde kurları günceller ve kalıcılaştırır. */
export function updateExchangeRates(rates) {
  if (!rates?.USD) return;
  Object.assign(EXCHANGE_RATES_TO_TRY, { USD: rates.USD, EUR: rates.EUR ?? EXCHANGE_RATES_TO_TRY.EUR });
  try {
    window.localStorage.setItem(
      FX_STORAGE_KEY,
      JSON.stringify({ USD: EXCHANGE_RATES_TO_TRY.USD, EUR: EXCHANGE_RATES_TO_TRY.EUR })
    );
  } catch {
    // sessizce geç
  }
}

export function toTRY(amount, currency) {
  const rate = EXCHANGE_RATES_TO_TRY[currency] ?? 1;
  return amount * rate;
}

/** Tek bir hisse için maliyet / değer / kar-zarar metrikleri (kendi para biriminde). */
export function getStockMetrics(stock) {
  const quantity = Number(stock.quantity) || 0;
  const avgPrice = Number(stock.avgPrice) || 0;
  const currentPrice = Number(stock.currentPrice) || 0;

  const totalCost = quantity * avgPrice;
  const currentValue = quantity * currentPrice;
  const profit = currentValue - totalCost;
  const profitPercent = totalCost > 0 ? (profit / totalCost) * 100 : 0;

  return { totalCost, currentValue, profit, profitPercent };
}

/** Tüm portföyün TRY cinsinden özet metrikleri. */
export function getPortfolioSummary(stocks) {
  let totalCost = 0;
  let totalValue = 0;

  for (const stock of stocks) {
    const m = getStockMetrics(stock);
    totalCost += toTRY(m.totalCost, stock.currency);
    totalValue += toTRY(m.currentValue, stock.currency);
  }

  const totalProfit = totalValue - totalCost;
  const totalProfitPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  return {
    totalCost,
    totalValue,
    totalProfit,
    totalProfitPercent,
    stockCount: stocks.length,
  };
}

/** Sektöre göre güncel değer dağılımı (TRY bazında, yüzde ile). */
export function getSectorAllocation(stocks) {
  const totals = new Map();
  let grandTotal = 0;

  for (const stock of stocks) {
    const value = toTRY(getStockMetrics(stock).currentValue, stock.currency);
    const sector = stock.sector?.trim() || 'Diğer';
    totals.set(sector, (totals.get(sector) || 0) + value);
    grandTotal += value;
  }

  return [...totals.entries()]
    .map(([name, value]) => ({
      name,
      value,
      percent: grandTotal > 0 ? (value / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

/** Hisseye göre güncel değer dağılımı (TRY bazında, yüzde ile). */
export function getStockAllocation(stocks) {
  const grandTotal = stocks.reduce(
    (sum, s) => sum + toTRY(getStockMetrics(s).currentValue, s.currency),
    0
  );

  return stocks
    .map((stock) => {
      const value = toTRY(getStockMetrics(stock).currentValue, stock.currency);
      return {
        name: stock.ticker,
        value,
        percent: grandTotal > 0 ? (value / grandTotal) * 100 : 0,
      };
    })
    .sort((a, b) => b.value - a.value);
}

/**
 * Dönemsel değişim seçenekleri. Yüzde değerleri şimdilik manuel/mock girilir;
 * gerçek fiyat API'si bağlandığında bu alanlar otomatik dolacaktır.
 */
export const PERIOD_OPTIONS = [
  { value: 'day', label: 'Gün', field: 'dailyChangePercent' },
  { value: 'month', label: 'Ay', field: 'monthlyChangePercent' },
  { value: 'threeMonth', label: '3 Ay', field: 'threeMonthChangePercent' },
];

/**
 * Seçilen dönem için yüzde değişim ve yaklaşık tutar (hisse para biriminde).
 * Tutar, dönem başı değer üzerinden hesaplanır: V - V / (1 + p/100).
 * Alan boşsa { percent: null, amount: null } döner.
 */
export function getPeriodChange(stock, period) {
  const option = PERIOD_OPTIONS.find((p) => p.value === period);
  const raw = stock[option.field];
  if (raw == null || raw === '') return { percent: null, amount: null };

  const percent = Number(raw);
  const { currentValue } = getStockMetrics(stock);
  const amount = currentValue - currentValue / (1 + percent / 100);
  return { percent, amount };
}

/** Tablo kolon sıralaması için karşılaştırma değeri üretir (tutarlar TRY bazında). */
export function getStockSortValue(stock, key, period) {
  const m = getStockMetrics(stock);
  switch (key) {
    case 'ticker':
      return stock.ticker;
    case 'sector':
      return stock.sector || '';
    case 'quantity':
      return Number(stock.quantity) || 0;
    case 'totalCost':
      return toTRY(m.totalCost, stock.currency);
    case 'currentValue':
      return toTRY(m.currentValue, stock.currency);
    case 'profit':
      return toTRY(m.profit, stock.currency);
    case 'profitPercent':
      return m.profitPercent;
    case 'periodChange':
      return getPeriodChange(stock, period).percent ?? -Infinity;
    default:
      return 0;
  }
}

/**
 * "Toplam Kar/Zarar" kartının dönem seçenekleri. range anahtarları, sunucudaki
 * PERIOD_RANGES ile birebir aynı olmalıdır.
 */
export const PROFIT_PERIODS = [
  { value: 'total', label: 'Toplam', cardLabel: 'Toplam Kar/Zarar' },
  { value: '1d', label: '1 Günlük', cardLabel: '1 Günlük Kar/Zarar' },
  { value: '1w', label: '1 Haftalık', cardLabel: '1 Haftalık Kar/Zarar' },
  { value: '1mo', label: '1 Aylık', cardLabel: '1 Aylık Kar/Zarar' },
  { value: '3mo', label: '3 Aylık', cardLabel: '3 Aylık Kar/Zarar' },
  { value: '1y', label: '1 Yıllık', cardLabel: '1 Yıllık Kar/Zarar' },
  { value: '3y', label: '3 Yıllık', cardLabel: '3 Yıllık Kar/Zarar' },
  { value: '5y', label: '5 Yıllık', cardLabel: '5 Yıllık Kar/Zarar' },
];

const FX_SYMBOL_FOR_CURRENCY = { USD: 'USDTRY=X', EUR: 'EURTRY=X' };

/** Hisse kaydını Yahoo sembolüne çevirir (THYAO+BIST → THYAO.IS). */
function toChangeSymbol(stock) {
  const ticker = String(stock.ticker ?? stock.symbol ?? '').toUpperCase();
  return stock.market === 'BIST' ? `${ticker}.IS` : ticker;
}

/**
 * Seçilen dönem için portföyün TRY cinsinden kar/zararı. changes: sembol→yüzde
 * (+ kur değişimleri). Her hissenin dönem başı TRY değeri, güncel değerin
 * (hisse % × kur %) birleşik çarpanına bölünmesiyle bulunur; fark = dönem K/Z.
 * Verisi olmayan hisseler atlanır (covered: en az bir hisse hesaba katıldı mı).
 */
export function getPortfolioPeriodProfit(stocks, changes) {
  if (!changes) return { profit: 0, percent: 0, covered: false };
  let profit = 0;
  let baselineValue = 0;

  for (const stock of stocks) {
    const stockPct = changes[toChangeSymbol(stock)];
    if (stockPct == null) continue;
    const fxPct =
      stock.currency === 'TRY' ? 0 : changes[FX_SYMBOL_FOR_CURRENCY[stock.currency]] ?? 0;
    const currentValueTRY = toTRY(getStockMetrics(stock).currentValue, stock.currency);
    const factor = (1 + stockPct / 100) * (1 + fxPct / 100);
    if (!(factor > 0)) continue;
    const baseline = currentValueTRY / factor;
    profit += currentValueTRY - baseline;
    baselineValue += baseline;
  }

  return {
    profit,
    percent: baselineValue > 0 ? (profit / baselineValue) * 100 : 0,
    covered: baselineValue > 0,
  };
}

/** Pazar adından varsayılan işlem para birimi (BIST→TRY, ABD borsaları→USD). */
export function getMarketCurrency(market) {
  return market === 'BIST' ? 'TRY' : 'USD';
}

const CURRENCY_LOCALES = { TRY: 'tr-TR', USD: 'en-US', EUR: 'de-DE' };

export function formatCurrency(amount, currency = 'TRY') {
  return new Intl.NumberFormat(CURRENCY_LOCALES[currency] ?? 'tr-TR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPercent(value) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatNumber(value) {
  return new Intl.NumberFormat('tr-TR').format(value);
}

/**
 * Portföy hesaplama yardımcıları.
 *
 * Döviz kurlarında SABİT VARSAYILAN YOKTUR: kur yalnızca canlı veriden veya
 * (tarihiyle birlikte saklanan) son bilinen canlı değerden gelir. Kur hiç
 * alınamamışsa TL'ye çevrim null döner ve arayüz "kur alınamadı" der —
 * aylar önceki bir sabitle gerçek gibi görünen tutar üretmek, kullanıcıya
 * yanlış para göstermektir (11 Kas 2026 incelemesi, madde 2).
 */
export const EXCHANGE_RATES_TO_TRY = {
  TRY: 1,
  USD: null,
  EUR: null,
};

const FX_STORAGE_KEY = 'portfoyai_fx_rates';

/** Kurların en son ne zaman CANLI veriyle güncellendiği (ISO). Hiç yoksa null. */
let fxRatesAsOf = null;

// Açılışta son bilinen canlı kurlar varsa onları tarihleriyle birlikte kullan
try {
  const stored = JSON.parse(window.localStorage.getItem(FX_STORAGE_KEY));
  if (stored?.USD) {
    Object.assign(EXCHANGE_RATES_TO_TRY, { USD: stored.USD, EUR: stored.EUR ?? null });
    fxRatesAsOf = stored.asOf ?? null;
  }
} catch {
  // localStorage erişilemezse kursuz devam et; arayüz durumu açıkça gösterir
}

/** Canlı FX verisi geldiğinde kurları günceller ve tarihiyle kalıcılaştırır. */
export function updateExchangeRates(rates) {
  if (!rates?.USD) return;
  Object.assign(EXCHANGE_RATES_TO_TRY, { USD: rates.USD, EUR: rates.EUR ?? EXCHANGE_RATES_TO_TRY.EUR });
  fxRatesAsOf = new Date().toISOString();
  try {
    window.localStorage.setItem(
      FX_STORAGE_KEY,
      JSON.stringify({
        USD: EXCHANGE_RATES_TO_TRY.USD,
        EUR: EXCHANGE_RATES_TO_TRY.EUR,
        asOf: fxRatesAsOf,
      })
    );
  } catch {
    // sessizce geç
  }
}

/** Kur saatinin bu kadar üstü "bayat" sayılır ve arayüzde tarihle işaretlenir. */
const FX_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Arayüzün "hangi kur, ne zamanki kur?" sorusuna cevabı.
 * available=false ise TL çevrimleri null döner ve toplam kartları hesaplanamaz.
 */
export function getFxStatus() {
  const usd = EXCHANGE_RATES_TO_TRY.USD;
  const available = Number.isFinite(usd);
  const asOf = fxRatesAsOf ? new Date(fxRatesAsOf) : null;
  const ageMs = asOf ? Date.now() - asOf.getTime() : null;
  return {
    available,
    usdRate: available ? usd : null,
    asOf,
    stale: available && (ageMs == null || ageMs > FX_STALE_MS),
  };
}

/**
 * Tutarı TL'ye çevirir. Kur bilinmiyorsa NULL döner — çağıran taraf bunu
 * "hesaplanamadı" olarak göstermekle yükümlüdür, sayı uydurulmaz.
 */
export function toTRY(amount, currency) {
  if (!currency || currency === 'TRY') return amount;
  const rate = EXCHANGE_RATES_TO_TRY[currency];
  return Number.isFinite(rate) ? amount * rate : null;
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

/**
 * Tüm portföyün TRY cinsinden özet metrikleri.
 *
 * DÜRÜSTLÜK NOTU: Maliyet de güncel değer de BUGÜNKÜ kurla çevrilir, çünkü
 * alış günündeki kur kayıtlı değildir. Bu yüzden buradaki kâr "yerel para
 * cinsinden fiyat kazancının bugünkü kurla TL karşılığı"dır; kur kazancını/
 * kaybını İÇERMEZ. Arayüz bu sınırı kullanıcıya açıkça söyler.
 * Kur hiç yoksa TL toplamları null döner (fxMissing=true) — sayı uydurulmaz.
 */
export function getPortfolioSummary(stocks) {
  let totalCost = 0;
  let totalValue = 0;
  let usesFx = false;
  let fxMissing = false;

  for (const stock of stocks) {
    if (stock.currency && stock.currency !== 'TRY') usesFx = true;
    const m = getStockMetrics(stock);
    const cost = toTRY(m.totalCost, stock.currency);
    const value = toTRY(m.currentValue, stock.currency);
    if (cost == null || value == null) {
      fxMissing = true;
      continue;
    }
    totalCost += cost;
    totalValue += value;
  }

  if (fxMissing) {
    return {
      totalCost: null,
      totalValue: null,
      totalProfit: null,
      totalProfitPercent: null,
      stockCount: stocks.length,
      usesFx,
      fxMissing: true,
    };
  }

  const totalProfit = totalValue - totalCost;
  const totalProfitPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  return {
    totalCost,
    totalValue,
    totalProfit,
    totalProfitPercent,
    stockCount: stocks.length,
    usesFx,
    fxMissing: false,
  };
}

/**
 * Sektöre göre güncel değer dağılımı (TRY bazında, yüzde ile).
 * Kur bilinmeyen bir hisse varsa boş liste döner: eksik hisseyle hesaplanan
 * yüzdeler yanlış ağırlık gösterirdi.
 */
export function getSectorAllocation(stocks) {
  const totals = new Map();
  let grandTotal = 0;

  for (const stock of stocks) {
    const value = toTRY(getStockMetrics(stock).currentValue, stock.currency);
    if (value == null) return [];
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

/**
 * Hisseye göre güncel değer dağılımı (TRY bazında, yüzde ile).
 * Kur bilinmeyen bir hisse varsa boş liste döner (bkz. getSectorAllocation).
 */
export function getStockAllocation(stocks) {
  const values = stocks.map((s) => toTRY(getStockMetrics(s).currentValue, s.currency));
  if (values.some((v) => v == null)) return [];
  const grandTotal = values.reduce((sum, v) => sum + v, 0);

  return stocks
    .map((stock, i) => ({
      name: stock.ticker,
      value: values[i],
      percent: grandTotal > 0 ? (values[i] / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Dönemsel değişim seçenekleri. Günlük yüzde canlı veriden (useLivePrices)
 * otomatik dolar; ay/3 ay alanları kullanıcı tarafından elle girilebilir.
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
      return toTRY(m.totalCost, stock.currency) ?? 0;
    case 'currentValue':
      return toTRY(m.currentValue, stock.currency) ?? 0;
    case 'profit':
      return toTRY(m.profit, stock.currency) ?? 0;
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
 *
 * ADLANDIRMA: Dönemli seçenekler "Kar/Zarar" değil "Sepet Değişimi" der, çünkü
 * hesap bugünkü adetlerin o dönem boyunca da elde tutulduğunu VARSAYAR — dönem
 * içindeki alım/satımları bilmez. Bugün alınan hisseye geçmiş dönem kârı
 * yazmamak için bu dürüst ad kullanılır (bkz. getPortfolioPeriodProfit).
 */
export const PROFIT_PERIODS = [
  { value: 'total', label: 'Toplam', cardLabel: 'Toplam Kar/Zarar' },
  { value: '1d', label: '1 Günlük', cardLabel: '1 Günlük Sepet Değişimi' },
  { value: '1w', label: '1 Haftalık', cardLabel: '1 Haftalık Sepet Değişimi' },
  { value: '1mo', label: '1 Aylık', cardLabel: '1 Aylık Sepet Değişimi' },
  { value: '3mo', label: '3 Aylık', cardLabel: '3 Aylık Sepet Değişimi' },
  { value: '1y', label: '1 Yıllık', cardLabel: '1 Yıllık Sepet Değişimi' },
  { value: '3y', label: '3 Yıllık', cardLabel: '3 Yıllık Sepet Değişimi' },
  { value: '5y', label: '5 Yıllık', cardLabel: '5 Yıllık Sepet Değişimi' },
];

const FX_SYMBOL_FOR_CURRENCY = { USD: 'USDTRY=X', EUR: 'EURTRY=X' };

/** Hisse kaydını Yahoo sembolüne çevirir (THYAO+BIST → THYAO.IS). */
function toChangeSymbol(stock) {
  const ticker = String(stock.ticker ?? stock.symbol ?? '').toUpperCase();
  return stock.market === 'BIST' ? `${ticker}.IS` : ticker;
}

/**
 * Seçilen dönem için BUGÜNKÜ SEPETİN varsayımsal TRY değişimi. changes:
 * sembol→yüzde (+ kur değişimleri). Her hissenin dönem başı TRY değeri, güncel
 * değerin (hisse % × kur %) birleşik çarpanına bölünmesiyle bulunur.
 *
 * SINIR: Bugünkü adetlerin dönem boyunca elde tutulduğu varsayılır; dönem
 * içindeki alım/satımlar bilinmez. Bu yüzden arayüzde "Kar/Zarar" değil
 * "Sepet Değişimi" olarak adlandırılır (PROFIT_PERIODS).
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
    if (currentValueTRY == null) continue; // kur yoksa bu hisse kapsanamaz
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
  if (amount == null || !Number.isFinite(Number(amount))) return '—';
  return new Intl.NumberFormat(CURRENCY_LOCALES[currency] ?? 'tr-TR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatNumber(value) {
  return new Intl.NumberFormat('tr-TR').format(value);
}

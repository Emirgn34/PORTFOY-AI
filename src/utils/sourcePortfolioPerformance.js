// Dataroma ilk 20 hisseyi yayımlar. Ağırlıklar yeniden %100'e şişirilmez;
// kalan kısım sıfır getirili nakit kabul edilir. Bu bir fon getirisi değildir.
const DAY = 86400000;
export function assessSourceHistory(reports, priceBySymbol, { start, end, minimumCoverage = 95 } = {}) {
  const startMs = Date.parse(start), endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return { eligible: false, reason: 'Geçersiz karşılaştırma dönemi.' };
  const ordered = [...reports].filter((r) => Date.parse(r.availableAt) <= endMs).sort((a,b) => Date.parse(a.availableAt) - Date.parse(b.availableAt));
  const initial = ordered.filter((r) => Date.parse(r.availableAt) <= startMs).at(-1);
  if (!initial) return { eligible: false, reason: 'İki yıl öncesindeki portföy kaydı eksik.' };
  const periods = [initial, ...ordered.filter((r) => Date.parse(r.availableAt) > startMs)];
  if (endMs-Date.parse(periods.at(-1).availableAt)>110*DAY || periods.some((r,i) => i>0 && Date.parse(r.availableAt)-Date.parse(periods[i-1].availableAt)>110*DAY)) {
    return { eligible:false,reason:'Çeyreklik portföy tarihçesinde boşluk veya eski son kayıt var.' };
  }
  let nav = 100, minimumObservedCoverage = 100, peak = 100, maxDrawdownPct = 0;
  const points = [];
  const seriesCache = new Map();
  function seriesFor(symbol) {
    if (!seriesCache.has(symbol)) seriesCache.set(symbol, (priceBySymbol[symbol] ?? []).filter((p) => Number.isFinite(p.adjclose) && p.adjclose > 0).sort((a,b) => Date.parse(a.date)-Date.parse(b.date)));
    return seriesCache.get(symbol);
  }
  function priceOnOrAfter(symbol, when) {
    const price = seriesFor(symbol).find((p) => Date.parse(p.date) >= when);
    return price && Date.parse(price.date) - when <= 5 * DAY ? price : null;
  }
  for (let index = 0; index < periods.length; index++) {
    const report = periods[index];
    const begin = Math.max(startMs, Date.parse(report.availableAt));
    const finish = index + 1 < periods.length ? Date.parse(periods[index + 1].availableAt) : endMs;
    const weight = report.holdings.reduce((sum,h) => sum+h.weightPct,0);
    if (weight < minimumCoverage || weight > 100.5 || !report.holdings.length || new Set(report.holdings.map((h) => h.symbol)).size !== report.holdings.length) return { eligible:false, reason:'Tarihsel hisse kapsamı %95 altında veya ağırlıklar geçersiz.' };
    minimumObservedCoverage = Math.min(minimumObservedCoverage,weight);
    // Aynı günün kapanışı uygulanır; açıklamadan önceki fiyattan işlem varsayılmaz.
    let factor = Math.max(0, 100-weight) / 100;
    for (const holding of report.holdings) {
      if (!(holding.weightPct >= 0)) return { eligible:false,reason:'Negatif ağırlık.' };
      const first = priceOnOrAfter(holding.symbol,begin), last = priceOnOrAfter(holding.symbol,finish);
      if (!first || !last || Date.parse(last.date) > endMs) return { eligible:false, reason:`${holding.symbol} için düzeltilmiş fiyat geçmişi eksik.` };
      factor += holding.weightPct / Math.max(100,weight) * last.adjclose / first.adjclose;
    }
    nav *= factor;
    peak = Math.max(peak,nav); maxDrawdownPct = Math.min(maxDrawdownPct,(nav/peak-1)*100);
    points.push({ date:new Date(finish).toISOString().slice(0,10),nav });
  }
  return { eligible:true, returnPct:Math.round((nav-100)*100)/100, coveragePct:Math.min(100,minimumObservedCoverage),
    periodCount:periods.length, periodDrawdownPct:Math.round(maxDrawdownPct*100)/100, points,
    method:'dataroma-top20-lag60-adjusted-v1', start, end };
}

// Salt yerel, sentetik denetim örnekleri. Canlı veri, hesap veya API kullanmaz.
// Çalıştırma: node reports/2026-10-03-inceleme-kanitlari.mjs
import assert from 'node:assert/strict';
import { getPortfolioSummary, getPortfolioPeriodProfit, updateExchangeRates } from '../src/utils/portfolioCalculations.js';
import { buildEntryPlan, getEntryStatusText } from '../src/utils/priceLevels.js';
import { buildPortfolioAnalysis } from '../server/portfolioAnalysis.js';
import { buildCandidates } from '../server/candidateBuilder.js';
import { analyzeTechnicals } from '../server/technicalAnalysis.js';
import { assessSourceHistory } from '../src/utils/sourcePortfolioPerformance.js';
import { buildValuePortfolios } from '../src/utils/valueSelection.js';
import { summarizeReturns } from '../server/backtestMetrics.js';
import { buildConviction } from '../server/evidence.js';
import { runEventWatch } from '../server/eventWatch.js';
import { __test as convictionInternals } from '../server/convictionAnalysis.js';
import { passesConvictionGate } from '../src/utils/conviction.js';

globalThis.fetch = async () => { throw new Error('Bu denetimde ağ erişimi kapalıdır.'); };
const evidence = [];
updateExchangeRates({ USD: 40, EUR: 45 });
const usdStock = { ticker: 'AUDIT', market: 'NASDAQ', currency: 'USD', quantity: 10, avgPrice: 100, currentPrice: 100 };
const summary = getPortfolioSummary([usdStock]);
assert.equal(summary.totalProfit, 0);
evidence.push({ id: 'F01', topic: 'Alış kuru olmayan toplam TL kar/zararı', inputs: { quantity: 10, buyPriceUsd: 100, nowPriceUsd: 100, assumedBuyFx: 30, nowFx: 40 }, observedProfitTry: summary.totalProfit, cashflowBasedProfitTry: 10000, note: 'Alış kuru mevcut veri modelinde yok; 30 TRY/USD yalnızca bu sentetik örneğin varsayımıdır.' });

const period = getPortfolioPeriodProfit([usdStock], { AUDIT: 25, 'USDTRY=X': 0 });
assert.equal(period.profit, 8000);
evidence.push({ id: 'F02', topic: 'Bugünkü pozisyonla geçmiş dönem karı', observed: period, actualProfitIfBoughtTodayAtCurrentPrice: 0, note: 'Bugün alınan pozisyon bile geçmiş dönemde tutulmuş gibi hesaplanır; alım tarihi girdisi yoktur.' });

const partial = getPortfolioPeriodProfit([usdStock, { ticker: 'MISSING', market: 'NASDAQ', currency: 'USD', quantity: 90, avgPrice: 100, currentPrice: 100 }], { AUDIT: 25 });
assert.equal(partial.covered, true);
evidence.push({ id: 'F03', topic: 'Yüzde 10 fiyat kapsamı ve eksik kurla dönem karı', observed: partial, actualPriceCoveragePct: 10, missingFxAssumedPct: 0 });

const plan = buildEntryPlan({ bandLow: 100, supports: [] }, 90);
assert.equal(plan.status, 'inside');
assert.ok(90 < plan.invalidation);
evidence.push({ id: 'F04', topic: 'Bozulma seviyesinin altında giriş etiketi', currentPrice: 90, observed: plan, observedText: getEntryStatusText(plan), expectedStatus: 'invalidated' });

const emptyProvider = { quote: async () => [], quoteSummary: async () => ({}) };
const missingDataAnalysis = await buildPortfolioAnalysis([usdStock], { yahooFinance: emptyProvider, getNewsForSymbol: async () => [], fx: { USD: 40, EUR: 45 }, anthropicKey: null });
assert.equal(missingDataAnalysis.portfolio.riskLevel, 'Düşük');
assert.equal(missingDataAnalysis.stocks.AUDIT.riskScore, 36);
evidence.push({ id: 'F05', topic: 'Fiyat, bilanço ve haber yokken analiz', observedPortfolio: missingDataAnalysis.portfolio, observedStock: missingDataAnalysis.stocks.AUDIT, expected: 'Veri yetersiz; ölçülmüş risk sınıfı ve skor üretilmemeli.' });

const mockQuote = { symbol: 'AUDIT', regularMarketPrice: 100, fullExchangeName: 'NasdaqGS', marketCap: 1e10, currency: 'USD' };
const mockProvider = { quote: async (symbols) => symbols.includes('AUDIT') ? [mockQuote] : [], quoteSummary: async () => ({ assetProfile: { sector: 'Technology' }, financialData: { targetMeanPrice: 120, numberOfAnalystOpinions: 12 } }) };
const candidateRows = await buildCandidates(['AUDIT'], { yahooFinance: mockProvider, getNewsForSymbol: async () => [], deep: false });
const expectation = candidateRows.find((r) => r.horizon === 'long').data.expectation;
assert.equal(expectation.drivers.length, 1);
assert.equal(expectation.confidenceLabel, 'yüksek');
const history = Array.from({ length: 505 }, (_, i) => ({ date: new Date(Date.UTC(2024, 0, i + 1)), close: 100 + i * 0.03 + Math.sin(i / 8) * 5, volume: 1000000 }));
const technicals = analyzeTechnicals(history);
assert.equal(technicals.analogLong.fwdDays, 60);
assert.equal(expectation.horizonDays, 252);
evidence.push({ id: 'F06', topic: 'Tek sürücüyle yüksek güven; uzun vade uyuşmazlığı', driverKeys: expectation.drivers.map((d) => d.key), confidence: expectation.confidence, confidenceLabel: expectation.confidenceLabel, longExpectationSessions: expectation.horizonDays, longAnalogSessions: technicals.analogLong.fwdDays });

const source = assessSourceHistory([{ availableAt: '2024-01-01', holdings: [{ symbol: 'AUDIT', weightPct: 100 }] }], { AUDIT: [{ date: '2024-01-01', adjclose: 100 }, { date: '2024-01-31', adjclose: 50 }, { date: '2024-03-01', adjclose: 110 }] }, { start: '2024-01-01', end: '2024-03-01' });
assert.equal(source.periodDrawdownPct, 0);
evidence.push({ id: 'F07', topic: 'Kaynak kıyasındaki dönem sonu düşüşü günlük maksimum düşüş değildir', observedPeriodDrawdownPct: source.periodDrawdownPct, actualDailyMaxDrawdownPct: -50, note: 'Mevcut alan periodDrawdownPct olarak adlandırılmış; gelecekte günlük maksimum düşüş diye sunulmamalı.' });

function valueCandidate(symbol, peRatio = 20) {
  return { symbol, companyName: symbol, market: 'NASDAQ', currency: 'USD', sector: 'Teknoloji', analysisDepth: 'deep', currentPrice: 100, riskLevel: 'Düşük', liquidityLevel: 'Yüksek', industry: 'Semiconductors', priceStructure: { bandLow: 96, supports: [{ level: 96, touches: 4 }] }, fundamentals: { peRatio, priceToBook: peRatio / 5, profitMarginPct: 10, revenueGrowthPct: 5, currentRatio: 2 }, scoreBreakdown: { fundamentalHealthScore: 80, riskAdjustedScore: 80, growthScore: 80, valuationScore: 70, dividendScore: 60, liquidityScore: 80 }, expectation: { expectedReturnPct: 10, expectedPrice: 110 } };
}
const valueRows = ['CHEAP', 'A', 'B', 'C', 'D', 'E'].map((s) => ({ horizon: 'long', data: valueCandidate(s, s === 'CHEAP' ? 10 : 20) }));
const manual = buildValuePortfolios({ rows: valueRows, generatedAt: '2026-10-03T12:00:00.000Z', preferences: { 'balanced-growth': { include: ['A'], exclude: [] } } }).find((p) => p.profileSlug === 'balanced-growth');
assert.equal(manual.holdings.length, 2);
assert.equal(manual.holdings.find((h) => h.manual).target.expectedReturnPct, undefined);
assert.notEqual(manual.metrics.expectedReturnPct, null);
evidence.push({ id: 'F08', topic: 'Manuel ekleme sonrası eksik tahmine rağmen eski portföy beklentisi korunuyor', actualHoldingCount: manual.holdings.length, metrics: manual.metrics, manualHoldingTarget: manual.holdings.find((h) => h.manual).target, expectedPortfolioReturnPct: null, note: 'Model çekirdeğinin tüm yatırım kalemlerinde beklenti gerektiren kuralıyla çelişir; PortfolioSet bugün bu metriği göstermiyor.' });

const withoutBenchmark = summarizeReturns([0.1], [], 10);
assert.equal(withoutBenchmark.excessMeanNet, 0);
evidence.push({ id: 'F09', topic: 'Benchmark yokken sıfır fazla getiri', observed: withoutBenchmark, expectedExcessMean: null });

const eventNews = [{ title: 'AUDIT wins major contract', publisher: 'Reuters', reliability: 9, published_at: new Date().toISOString() }];
const eventTech = { pctFrom52High: 0, ret20: 5, rsi: 60 };
const eventMetrics = { volumeConfirmationScore: 50, riskLevel: 'Düşük' };
const ruleConviction = buildConviction({ newsRows: eventNews, metrics: eventMetrics, tech: eventTech, price: 100, referenceMs: Date.now(), context: { riskLevel: 'Düşük', positiveNewsCount: 1, negativeNewsCount: 0 } });
const aiCandidate = { conviction: structuredClone(ruleConviction) };
convictionInternals.applyDecision(aiCandidate, { certainty: 0, reason_code: 'WEAK_OR_GENERIC' });
const previousConviction = aiCandidate.conviction;
const lightRow = { symbol: 'AUDIT', generation: 1, snap: eventTech, ps: null, conv: previousConviction, analyst: null, risk: 'Düşük', price: 100, ticker: 'AUDIT', company: 'AUDIT', sector: 'Technology', posNews: 1, negNews: 0, volScore: 50, edge: { hasActionableEdge: true } };
let eventWrites = [];
const auditSb = async (query, options = {}) => {
  if (options.method === 'POST') { eventWrites = options.body; return []; }
  if (query.includes('horizon=eq.short')) return [lightRow];
  return [{ symbol: 'AUDIT', horizon: 'short', market: 'NASDAQ', generation: 1, data: { conviction: previousConviction } }];
};
const originalLog = console.log;
try {
  console.log = () => {};
  await runEventWatch({ sb: auditSb, quoteMap: new Map(), getNewsForSymbol: async () => eventNews });
} finally { console.log = originalLog; }
const afterEventWatch = eventWrites[0].data.conviction;
assert.equal(previousConviction.score, 54);
assert.equal(afterEventWatch.score, 90);
assert.equal(afterEventWatch.aiCertainty, 0);
evidence.push({ id: 'F10', topic: 'Aynı kanıtta olay nöbeti AI indiriminin etkisini kaldırıyor', before: { score: previousConviction.score, aiCertainty: previousConviction.aiCertainty, passesGate: passesConvictionGate(previousConviction) }, after: { score: afterEventWatch.score, aiCertainty: afterEventWatch.aiCertainty, passesGate: passesConvictionGate(afterEventWatch) }, note: 'Aynı haber, fiyat ve teknik veri; AI çağrısı ve gerçek veritabanı yazımı yoktur.' });

console.log(JSON.stringify({ date: '2026-10-03', method: 'Yerel sentetik örnekler; ağ erişimi kapalı; uygulama kaynakları değiştirilmedi.', checks: evidence }, null, 2));

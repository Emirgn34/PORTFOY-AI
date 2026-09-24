import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import YahooFinance from 'yahoo-finance2';
import { assessSourceHistory } from '../src/utils/sourcePortfolioPerformance.js';
import { buildModelPortfolios, isUsEquity } from '../src/utils/modelPortfolioCore.js';
import { buildCandidates } from './candidateBuilder.js';
import { buildEntryPlan } from '../src/utils/priceLevels.js';
import { mapLimit } from './concurrency.js';
import { checked, recordMonitor } from './automationDb.js';
import { deliverNotifications } from './pushNotifications.js';

const DAY = 86400000;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let lastFetch = 0;
async function dataroma(path) {
  const wait = Math.max(0, 1000 - (Date.now() - lastFetch));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastFetch = Date.now();
  const response = await fetch(`https://www.dataroma.com${path}`, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent':'PortfoyAI research monitor' } });
  if (!response.ok) throw new Error(`Dataroma kaynağı alınamadı (${response.status}).`);
  return response.text();
}
export function parseDataromaManagers(html) {
  const $ = load(html), managers = new Map();
  $('#grid td.man a').each((_,element) => {
    const href = $(element).attr('href');
    const slug = new URL(href,'https://www.dataroma.com').searchParams.get('m');
    if (/^[A-Z0-9-]+$/.test(slug ?? '')) managers.set(slug, { slug,name:$(element).text().trim(),url:`https://www.dataroma.com/m/holdings.php?m=${slug}` });
  });
  if (!managers.size) throw new Error('Kaynak yatırımcı listesi doğrulanamadı; önceki sepetler korundu.');
  return [...managers.values()];
}
export function parseDataromaHistory(html) {
  const $ = load(html), reports = [];
  $('#grid tr').each((_, row) => {
    const period = $(row).find('td.period').text().match(/(20\d{2})\s+Q([1-4])/);
    if (!period) return;
    const reportDate = new Date(Date.UTC(Number(period[1]),Number(period[2])*3,0));
    const holdings = [];
    $(row).find('td.sym').each((__, cell) => {
      const symbol = $(cell).find('a').first().text().trim().replace('.', '-');
      const weight = $(cell).text().match(/(\d+(?:\.\d+)?)% of portfolio/);
      if (/^[A-Z][A-Z0-9-]{0,9}$/.test(symbol) && weight && Number(weight[1])>0) holdings.push({ symbol,weightPct:Number(weight[1]) });
    });
    reports.push({ reportDate:reportDate.toISOString().slice(0,10),
      // Bildirim günü bu kaynakta yok. Varsayımı açık etiketle; gerçek açıklama tarihi sanma.
      availableAt:new Date(reportDate.getTime()+60*DAY).toISOString(), holdings });
  });
  if (!reports.length) throw new Error('Kaynak tarihçe yapısı doğrulanamadı.');
  return reports.sort((a,b) => a.reportDate.localeCompare(b.reportDate));
}
export async function refreshSourcePortfolios(sb) {
  const now = new Date();
  const start = new Date(now); start.setUTCFullYear(start.getUTCFullYear()-2); start.setUTCHours(0,0,0,0);
  const end = new Date(now); end.setUTCDate(end.getUTCDate()-1); end.setUTCHours(23,59,59,999);
  const managers = parseDataromaManagers(await dataroma('/m/managers.php'));
  const histories = [], errors = [];
  for (const manager of managers) {
    try {
      const reports = parseDataromaHistory(await dataroma(`/m/hist/p_hist.php?f=${encodeURIComponent(manager.slug)}`))
        .filter((r) => Date.parse(r.reportDate) >= start.getTime()-200*DAY && Date.parse(r.availableAt) <= end.getTime());
      histories.push({ ...manager,reports });
    } catch (error) { errors.push({name:manager.name,reason:error.message}); }
  }
  if (errors.length > managers.length*0.1) throw new Error('Kaynakların %10’dan fazlası okunamadı; sıralama ve sepetler değiştirilmedi.');
  const yahooFinance = new YahooFinance({ suppressNotices:['yahooSurvey'] });
  const priceBySymbol = {};
  // Önce kapsamı yeterli yöneticiler: geniş fonların eksik ilk-20 listeleri sıralanmaz.
  const covered = histories.filter((m) => m.reports.length >= 9 && m.reports.every((r) => r.holdings.reduce((s,h) => s+h.weightPct,0) >= 95));
  const symbols = [...new Set(covered.flatMap((m) => m.reports.flatMap((r) => r.holdings.map((h) => h.symbol))))];
  await mapLimit(symbols,3,async (symbol) => {
    try {
      // Son işlem günü bugünden önce olabilir; iki yıllık baz kapanışını da al.
      const result = await yahooFinance.chart(symbol,{period1:new Date(start.getTime()-10*DAY),period2:now,interval:'1d'});
      priceBySymbol[symbol] = (result.quotes ?? []).map((q) => ({date:new Date(q.date).toISOString().slice(0,10),adjclose:q.adjclose}));
    } catch { priceBySymbol[symbol] = []; }
  });
  // Son tam işlem günü: SPY yalnızca takvim referansı; portföy kıyası USD bazında.
  const calendar = await yahooFinance.chart('SPY',{period1:new Date(end.getTime()-10*DAY),period2:now,interval:'1d'});
  const lastDay = calendar.quotes?.filter((q) => new Date(q.date).getTime() <= end.getTime() && q.close > 0).at(-1)?.date;
  if (!lastDay) throw new Error('Ortak son işlem günü alınamadı.');
  const comparisonEnd = new Date(lastDay).toISOString().slice(0,10);
  const comparisonStart = new Date(`${comparisonEnd}T00:00:00Z`); comparisonStart.setUTCFullYear(comparisonStart.getUTCFullYear()-2);
  const assessed = histories.map((m) => ({...m,...assessSourceHistory(m.reports,priceBySymbol,{start:comparisonStart.toISOString().slice(0,10),end:comparisonEnd})}));
  const rankings = assessed.filter((m) => m.eligible).sort((a,b) => b.returnPct-a.returnPct);
  if (!rankings.length) throw new Error('Eksiksiz iki yıllık karşılaştırmaya uygun kaynak bulunamadı. Eksik veriyle kazanan üretilmedi.');
  const leaders = rankings.slice(0,5);
  const latestSymbols = [...new Set(leaders.flatMap((m) => m.reports.at(-1).holdings.map((h) => h.symbol)))];
  const rows = await buildCandidates(latestSymbols,{yahooFinance,deep:true,concurrency:3,
    getNewsForSymbol:async (symbol) => checked(await sb.from('news').select('*').eq('symbol',symbol).order('published_at',{ascending:false}).limit(30))});
  if (new Set(rows.filter((r) => r.data.analysisDepth==='deep').map((r) => r.symbol)).size < latestSymbols.length*0.9) throw new Error('Kaynak hisselerinin güncel analiz kapsamı eksik; önceki sepetler korundu.');
  const candidates = rows.filter((r) => isUsEquity(r.data) && r.data.analysisDepth==='deep')
    // Giriş bölgesinden uzaklaşmış hisseleri yeni alım sepetine zorlama.
    .filter((r) => {
      const plan=buildEntryPlan(r.data.priceStructure,r.data.currentPrice);
      return plan && ['inside','near'].includes(plan.status) && r.data.currentPrice>plan.invalidation;
    });
  const portfolios = buildModelPortfolios({
    shortCandidates:candidates.filter((r) => r.horizon==='short').map((r) => r.data),
    longCandidates:candidates.filter((r) => r.horizon==='long').map((r) => r.data), generatedAt:now.toISOString(),
  }).map((p) => ({ ...p,slug:`source-${p.slug}`,versionKey:`source-${p.slug}--${now.toISOString()}`,rebalanceFrequency:'source-change',
    holdings:p.holdings.map((h) => ({...h,sourceManagers:leaders.filter((m) => m.reports.at(-1).holdings.some((s) => s.symbol===h.ticker)).map((m) => m.name)})) }));
  const selectionFingerprint = hash(portfolios.map((p) => ({slug:p.slug,holdings:p.holdings.map((h) => [h.ticker,h.weightPct]).sort(),cash:p.cashWeightPct})));
  const data = { selectionFingerprint,portfolios,period:{start:comparisonStart.toISOString().slice(0,10),end:comparisonEnd},
    rankings:rankings.map(({reports,points,...r}) => ({...r,latestReportDate:reports.at(-1)?.reportDate,selected:leaders.some((l) => l.slug===r.slug)})),
    excluded:[...assessed.filter((m) => !m.eligible).map((m) => ({name:m.name,reason:m.reason})),...errors],
    checkedCount:managers.length,method:'Dataroma ilk 20 hisse, varsayımsal 60 günlük açıklama gecikmesi, USD düzeltilmiş kapanış, kalan ağırlık nakit. Vergi, komisyon ve fon giderleri hariç. Gerçek fon getirisi değildir; geçmiş düzeltmeler ve güncel yatırımcı listesi yanlılık yaratabilir.',
  };
  const fingerprint = hash({date:now.toISOString().slice(0,10),data});
  // Sepet ve bildirim olayı aynı işlemde yayımlanır; aradaki kesinti bildirimi kaybetmez.
  checked(await sb.rpc('publish_source_portfolios',{p_fingerprint:fingerprint,p_data:data}));
  await recordMonitor(sb,'sources',{ok:true,checkedCount:managers.length,rankedCount:rankings.length});
  await deliverNotifications(sb);
  return data;
}

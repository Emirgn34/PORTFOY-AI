import YahooFinance from 'yahoo-finance2';
import { buildCandidates } from './candidateBuilder.js';
import { buildValuePortfolios } from '../src/utils/valueSelection.js';
import { isUsEquity } from '../src/utils/modelPortfolioCore.js';
import { checked } from './automationDb.js';

export async function processValuePortfolioJob(sb) {
  const job = checked(await sb.rpc('claim_value_portfolio_job'))?.[0];
  if (!job) return false;
  try {
    const latest = checked(await sb.from('candidates').select('generation').not('generation','is',null).order('generation', { ascending: false }).limit(1))?.[0];
    if (!latest) throw new Error('Aday havuzu henüz oluşmamış.');
    const stored = [];
    for (let offset = 0; ; offset += 1000) {
      const page = checked(await sb.from('candidates').select('symbol,horizon,data').eq('generation', latest.generation).order('symbol').order('horizon').range(offset, offset + 999));
      stored.push(...page); if (page.length < 1000) break;
    }
    const requested = Object.values(job.preferences).flatMap((p) => p.include ?? []);
    const symbols = [...new Set([...stored.filter((r) => isUsEquity(r.data)).map((r) => r.symbol), ...requested])];
    if (!symbols.length) throw new Error('ABD aday havuzu boş.');
    const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const rows = await buildCandidates(symbols, { yahooFinance, deep: true, concurrency: 4,
      getNewsForSymbol: async (symbol) => checked(await sb.from('news').select('*').eq('symbol',symbol).order('published_at', { ascending: false }).limit(30)),
    });
    const completed = new Set(rows.filter((r) => r.data.analysisDepth === 'deep').map((r) => r.symbol));
    if (completed.size < symbols.length * 0.9) throw new Error('Güncel analiz kapsamı %90 altında kaldı. Önceki sepetler korunuyor; tekrar deneyin.');
    const portfolios = buildValuePortfolios({ rows, preferences: job.preferences });
    checked(await sb.rpc('finish_value_portfolio_job', { p_id: job.id, p_portfolios: portfolios }));
  } catch (error) {
    checked(await sb.from('portfolio_jobs').update({ status: 'failed', error: error.message.slice(0, 400), completed_at: new Date().toISOString() }).eq('id', job.id).eq('status','running'));
  }
  return true;
}

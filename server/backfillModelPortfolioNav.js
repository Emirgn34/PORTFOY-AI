import YahooFinance from 'yahoo-finance2';
import { modelPortfolioBackfillSymbols, buildMissingModelPortfolioNavRows } from './modelPortfolioNavBackfill.js';
import { mapLimit } from './concurrency.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.');
async function sb(path, body) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`NAV onarımı Supabase ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
}
const versions = await sb('model_portfolio_versions?select=version_key,slug,cycle_start,cycle_end,data&order=cycle_start.desc,risk_tier.asc&limit=4');
if (versions.length !== 4) throw new Error('Dört aylık sürüm bulunamadı.');
const navRows = await sb(`model_portfolio_nav?version_key=in.(${versions.map((v) => `"${v.version_key}"`).join(',')})&select=version_key,nav_date&order=nav_date.asc&limit=1000`);
if (navRows.length >= 1000) throw new Error('NAV okuma sınırı aşıldı; eksik geçmişle onarım yapılmadı.');
const now = new Date().toISOString();
const firstDate = [...navRows].sort((a, b) => a.nav_date.localeCompare(b.nav_date))[0]?.nav_date;
if (!firstDate) throw new Error('Tarihsel onarım için başlangıç kaydı yok.');
const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const histories = {};
await mapLimit(modelPortfolioBackfillSymbols(versions, `${firstDate}T00:00:00Z`), 4, async (symbol) => {
  // Already-settled symbols do not have a usable chart. They are valued from
  // the verified cash consideration on repair dates after the acquisition.
  try {
    histories[symbol] = await yahoo.chart(symbol, {
      period1: new Date(Date.parse(versions[0].cycle_start) - 7 * 86_400_000),
      period2: new Date(now), interval: '1d', events: 'split',
    });
  } catch (error) {
    console.warn(`[nav-repair] ${symbol} geçmişi okunamadı: ${error.message}`);
  }
});
const rows = buildMissingModelPortfolioNavRows({ versions, navRows, histories, now });
console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry-run',
  missingRows: rows.map(({version_key,nav_date,nav_value,coverage_pct}) => ({version_key,nav_date,nav_value,coverage_pct})) }));
if (process.argv.includes('--apply') && rows.length) {
  const inserted = await sb('model_portfolio_nav', rows);
  console.log(`[nav-repair] ${inserted.length} eksik günlük kayıt tarihsel kapanışlarla tamamlandı; mevcut kayıtlar korundu.`);
}

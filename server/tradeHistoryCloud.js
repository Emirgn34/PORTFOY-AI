/** Bounded forward-test collection on the existing minute news cron.
 * Historical candles settle previously archived plans; they never create a
 * trade at an earlier decision time, or certify Yahoo as a live feed.
 */
import YahooFinance from 'yahoo-finance2';
import { checked } from './automationDb.js';
import { normalizeTradeBatch, processTradeBatch } from './tradeData.js';
import { researchTradeBatch, tradeUniverse } from './tradeWorker.js';
import { isTradeHistoryNotInstalled, loadPendingTradeHistorySymbols, syncTradeHistory } from './tradeHistory.js';

export const CLOUD_TRADE_HISTORY_BATCH = 5;
const SOURCE = 'Yahoo Finance · gecikmeli araştırma';
const validSymbol = (value) => /^[A-Z][A-Z0-9.-]{0,14}$/.test(value);

export async function scanCloudTradeHistory(sb, {
  yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] }),
  now = Date.now(), env = process.env, limit = CLOUD_TRADE_HISTORY_BATCH,
  monotonic = () => performance.now(),
  universe = tradeUniverse, loadPending = loadPendingTradeHistorySymbols,
  collect = researchTradeBatch, processBatch = processTradeBatch, sync = syncTradeHistory,
} = {}) {
  const scanStarted = monotonic();
  const decisionClock = () => now + Math.max(0, Math.ceil(monotonic() - scanStarted));
  // Probe the new table before touching external providers. Missing migration
  // is a rollout state and must not disable the established news automation.
  const probe = await sb.from('trade_history').select('id').limit(1);
  if (probe.error) {
    if (isTradeHistoryNotInstalled(probe.error)) return { installationRequired: true, scanned: 0 };
    throw new Error('Trade geçmişi veritabanına ulaşılamadı.');
  }
  const canCreate = !env.TRADE_LICENSED_SOURCE && env.TRADE_RESEARCH_FALLBACK !== 'false';
  const [researchSymbols, liveSymbols, watched, previousResult] = await Promise.all([
    loadPending(sb, { limit: 100, mode: 'research' }),
    loadPending(sb, { limit: 100, mode: 'live' }),
    canCreate ? universe(sb) : [],
    sb.from('monitor_status').select('data').eq('id', 'trade-history').maybeSingle(),
  ]);
  const previous = checked(previousResult);
  const attempts = previous?.data?.attempts ?? {};
  const symbols = [...new Set([...researchSymbols, ...watched])].filter(validSymbol).slice(0, 200);
  const selected = symbols.filter((symbol) => now - (Date.parse(attempts[symbol]) || 0) >= 60_000)
    .sort((a, b) => (Date.parse(attempts[a]) || 0) - (Date.parse(attempts[b]) || 0))
    .slice(0, Math.max(1, Math.min(5, Number(limit) || CLOUD_TRADE_HISTORY_BATCH)));
  const at = new Date(now).toISOString();
  const nextAttempts = Object.fromEntries(symbols.map((symbol) => [symbol, selected.includes(symbol) ? at : attempts[symbol] ?? null]));
  const selectedLive = liveSymbols.filter(validSymbol)
    .filter((symbol) => now - (Date.parse(attempts[`live:${symbol}`]) || 0) >= 60_000)
    .sort((a,b) => (Date.parse(attempts[`live:${a}`]) || 0) - (Date.parse(attempts[`live:${b}`]) || 0)).slice(0, 3);
  for (const symbol of liveSymbols.filter(validSymbol)) nextAttempts[`live:${symbol}`] = selectedLive.includes(symbol) ? at : attempts[`live:${symbol}`] ?? null;
  let failed = 0, scanned = 0;
  // Clock-only aging can mark an observation unresolved. It cannot fill a
  // position, hit a target, or score a live trade from delayed research data.
  for (const symbol of selectedLive) {
    const result = await sync(sb, null, { symbol, quote: { realtime: true }, bars: [] }, { now, createPlans: false });
    if (result?.available === false) failed++;
  }
  if (selected.length) {
    let payload;
    try { payload = await collect(yahoo, selected, { now, timeoutMs: 4500 }); }
    catch { payload = { items: [] }; }
    const observed = new Set((payload.items ?? []).map((item) => item.symbol));
    if (payload.items?.length) {
      if (canCreate) {
        const result = await processBatch(sb, payload, { source: SOURCE, licensed: false, now: decisionClock, env, deliver: false });
        scanned = result.items.length;
        failed += result.items.filter((item) => item.history?.available === false).length;
      } else {
        // With a licensed source configured, do not publish research snapshots
        // or replace the feed monitor. Only finish old research observations.
        const snapshots = normalizeTradeBatch(payload, { source: SOURCE, licensed: false, now });
        for (const snapshot of snapshots) {
          const result = await sync(sb, null, snapshot, { now, createPlans: false });
          if (result?.available === false) failed++;
          scanned++;
        }
      }
    }
    for (const symbol of selected.filter((symbol) => !observed.has(symbol))) {
      failed++;
      await sync(sb, null, { symbol, quote: { realtime: false }, bars: [] }, { now, createPlans: false });
    }
  }
  const status = { ok: failed === 0, running: true, mode: 'cloud-replay', lastCycleAt: at,
    lastSuccessfulAt: scanned ? at : previous?.data?.lastSuccessfulAt ?? null,
    checkedCount: scanned, failedCount: failed, attempts: nextAttempts,
    message: 'Dakikalık bulut turu kapanmış mumlarla geçmiş planları değerlendirir; canlı emir veya canlı fiyat doğrulaması yapmaz.' };
  checked(await sb.from('monitor_status').upsert({ id: 'trade-history', updated_at: at, data: status }));
  return { scanned, failed, pendingSymbols: researchSymbols.length + liveSymbols.length };
}

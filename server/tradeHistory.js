import { buildTradeHistoryPlans, advanceTradeHistory } from './tradeHistoryEngine.js';

const OPEN_STATUSES = ['pending','active'];
const STATUSES = [...OPEN_STATUSES,'target','stop','expired','ambiguous','unresolved'];
const symbolPattern = /^[A-Z][A-Z0-9.-]{0,14}$/;

function resultData(result) {
  if (result?.error) {
    const error = new Error(result.error.message || 'Trade geçmişi veri hizmetine ulaşılamadı.');
    error.code = result.error.code;
    throw error;
  }
  return result?.data;
}

export function isTradeHistoryNotInstalled(error) {
  const message = String(error?.message ?? '');
  const historyObject = /\btrade_history\b|\bsave_trade_history\b|\bread_trade_history\b/i.test(message);
  return historyObject && (['42P01','42883','PGRST202','PGRST205'].includes(error?.code)
    || /(?:relation|function).*does not exist|could not find (?:the )?(?:table|function)/i.test(message));
}

function installedEmpty(page=1,pageSize=20) {
  return {items:[],summary:{total:0,pending:0,active:0,completed:0,resolved:0,settledCount:0,targetCount:0,stopCount:0,
    expiredCount:0,ambiguousCount:0,unresolvedCount:0,winRate:null,targetRate:null,stopRate:null,
    averageNetReturnPct:null,byTarget:[]},pagination:{page,pageSize,total:0,hasMore:false},
  tracking:{lastCheckedAt:null,pendingCount:0,message:'Geçmiş trade takibi henüz etkinleştirilmedi.'},installationRequired:true};
}

/** Persist model progression with optimistic locking. A concurrent source may
 * win the write; retry against its saved state, never overwrite its progress. */
async function saveProgress(sb,row,snapshot,now) {
  let current=row;
  for (let attempt=0;attempt<3;attempt++) {
    if (!current || !OPEN_STATUSES.includes(current.status)) return false;
    const next=advanceTradeHistory(current.data,snapshot,{now});
    if (JSON.stringify(next)===JSON.stringify(current.data)) return false;
    const saved=resultData(await sb.rpc('save_trade_history',{p_record:next,p_expected_revision:current.revision}));
    if (saved?.saved) return true;
    current=resultData(await sb.from('trade_history').select('id,status,revision,data').eq('id',row.id).maybeSingle());
  }
  return false;
}

/** Run on every accepted provider batch. Existing models are evaluated before
 * newly generated plans, so no prepublication candle can enter a new trade. */
export async function syncTradeHistory(sb,candidate,snapshot,{now=Date.now(),createPlans=true}={}) {
  try {
    const symbol=snapshot?.symbol ?? candidate?.symbol;
    if (!symbolPattern.test(symbol ?? '')) return {available:true,createdCount:0,updatedCount:0};
    const mode=snapshot?.quote?.realtime===true?'live':'research';
    const rows=resultData(await sb.from('trade_history').select('id,status,revision,data')
      .eq('symbol',symbol).eq('mode',mode).in('status',OPEN_STATUSES)) ?? [];
    let updatedCount=0,createdCount=0;
    for (const row of rows) if (await saveProgress(sb,row,snapshot,now)) updatedCount++;
    const plans=createPlans && candidate?buildTradeHistoryPlans(candidate,snapshot,{now}):[];
    for (const plan of plans) {
      const saved=resultData(await sb.rpc('save_trade_history',{p_record:plan,p_expected_revision:null}));
      if (saved?.saved) createdCount++;
    }
    return {available:true,createdCount,updatedCount};
  } catch (error) {
    if (isTradeHistoryNotInstalled(error)) return {available:false,installationRequired:true,createdCount:0,updatedCount:0};
    throw error;
  }
}

/** Bounded universe for rotating background collection, not a performance
 * aggregate. The read RPC aggregates all filtered records independently. */
export async function loadPendingTradeHistorySymbols(sb,{limit=100,mode}={}) {
  let query=sb.from('trade_history').select('symbol').in('status',OPEN_STATUSES).order('created_at',{ascending:true}).limit(1000);
  if (mode) query=query.eq('mode',mode);
  try {
    const rows=resultData(await query) ?? [];
    return [...new Set(rows.map((row)=>row.symbol))].slice(0,Math.max(1,Math.min(100,Number(limit)||100)));
  } catch (error) {
    if (isTradeHistoryNotInstalled(error)) return [];
    throw error;
  }
}

function invalidFilter() {
  const error=new Error('Geçmiş trade filtresi geçersiz.');
  error.statusCode=400;
  return error;
}

export function normalizeTradeHistoryFilters(input={},now=Date.now()) {
  for (const key of ['period','symbol','strategy','mode','status','page','pageSize']) {
    if (input[key]!==undefined && typeof input[key]!=='string' && typeof input[key]!=='number') throw invalidFilter();
  }
  const period=String(input.period ?? '30');
  if (!['7','30','90','all'].includes(period)) throw invalidFilter();
  const symbol=String(input.symbol ?? '').trim().toUpperCase();
  if (symbol && !symbolPattern.test(symbol)) throw invalidFilter();
  const strategy=String(input.strategy ?? 'all');
  if (strategy!=='all' && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(strategy)) throw invalidFilter();
  const mode=String(input.mode ?? 'all'),status=String(input.status ?? 'all');
  if (!['all','research','live'].includes(mode) || !['all',...STATUSES].includes(status)) throw invalidFilter();
  const page=Number(input.page ?? 1),pageSize=Number(input.pageSize ?? 20);
  if (!Number.isInteger(page) || page<1 || page>100000 || !Number.isInteger(pageSize) || pageSize<1 || pageSize>100) throw invalidFilter();
  return {p_since:period==='all'?null:new Date(now-Number(period)*86400000).toISOString(),
    p_symbol:symbol || null,p_strategy:strategy==='all'?null:strategy,p_mode:mode==='all'?null:mode,
    p_status:status==='all'?null:status,p_page:page,p_page_size:pageSize};
}

export async function readTradeHistory(sb,filters={}) {
  const args=normalizeTradeHistoryFilters(filters,filters.now ?? Date.now());
  try {
    const history=resultData(await sb.rpc('read_trade_history',args));
    if (!history || !Array.isArray(history.items) || !history.summary || !history.pagination) throw new Error('Geçmiş trade yanıtı geçersiz.');
    // Status is informational. Failure to read monitoring must not hide a
    // durable journal, and no feed health is inferred from a model result.
    let monitor=null;
    try { monitor=resultData(await sb.from('monitor_status').select('updated_at,data').eq('id','trade-history').maybeSingle()); } catch { /* optional telemetry */ }
    return {...history,tracking:{...history.tracking,...(monitor?{monitorUpdatedAt:monitor.updated_at,...monitor.data}:{})},
      installationRequired:false,serverTime:new Date(filters.now ?? Date.now()).toISOString()};
  } catch (error) {
    if (isTradeHistoryNotInstalled(error)) return installedEmpty(args.p_page,args.p_page_size);
    throw error;
  }
}

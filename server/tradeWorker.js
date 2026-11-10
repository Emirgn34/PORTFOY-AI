/** Continuous adapter runner. Hosted Vercel request handlers are not daemons. */
import { pathToFileURL } from 'node:url';
import YahooFinance from 'yahoo-finance2';
import { automationDb, checked, recordMonitor } from './automationDb.js';
import { candidateTradeSymbol, processTradeBatch } from './tradeData.js';
import { deliverNotifications } from './pushNotifications.js';
import { mapLimit } from './concurrency.js';
import { getMacroCalendar } from './macroCalendar.js';
import { getMarketIntelligence } from './marketIntelligence.js';

export async function tradeUniverse(sb) {
  const [tracked,candidates]=await Promise.all([
    sb.from('tracked_symbol_queue').select('symbol').order('symbol').limit(100),
    sb.from('candidates').select('symbol,market').eq('horizon','short').order('updated_at',{ascending:false}).limit(100),
  ]);
  return [...new Set([...(checked(tracked) ?? []).map((row)=>row.symbol),...(checked(candidates) ?? []).map(candidateTradeSymbol)])]
    .filter((symbol)=>/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)).slice(0,50);
}

export async function readTradeFeed(urlValue, token, symbols, {fetcher=fetch} = {}) {
  const url=new URL(urlValue);
  if (url.protocol!=='https:' || url.username || url.password) throw new Error('Trade adaptörü HTTPS kullanmalı; kimlik bilgileri URL içinde olamaz.');
  if (!token) throw new Error('TRADE_FEED_TOKEN gerekli.');
  url.searchParams.set('symbols',symbols.join(','));
  const response=await fetcher(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(4000),redirect:'error'});
  if (!response.ok) throw new Error('Lisanslı veri adaptörüne bağlanılamadı.');
  const reader=response.body?.getReader();
  if (!reader) throw new Error('Adaptör yanıtı boş.');
  const chunks=[];let bytes=0;
  for (;;) {
    const {done,value}=await reader.read(); if(done) break;
    bytes+=value.length;
    if(bytes>4*1024*1024) {await reader.cancel();throw new Error('Adaptör yanıtı 4 MB sınırını aştı.');}
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function researchTradeBatch(yahoo,symbols,{now=Date.now()}={}) {
  if (!symbols.length) return {items:[]};
  const raw=await yahoo.quote(symbols);
  const quotes=Array.isArray(raw)?raw:[raw];
  const items=await mapLimit(quotes,3,async (q)=>{
    if (!q?.symbol || !(q.regularMarketPrice>0) || !q.regularMarketTime) return null;
    let bars=[];
    try {
      const chart=await yahoo.chart(q.symbol,{period1:new Date(now-3*86400000),interval:'1m'});
      bars=(chart?.quotes ?? []).filter((bar)=>['open','high','low','close','volume'].every((key)=>typeof bar[key]==='number' && Number.isFinite(bar[key])) && new Date(bar.date).getTime()+60_000<=now)
        .slice(-500).map((bar)=>({time:new Date(bar.date).toISOString(),open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume}));
    } catch { /* Missing research bars remain explicitly blocked. */ }
    return {symbol:q.symbol,barIntervalSeconds:60,bars,quote:{price:q.regularMarketPrice,bid:q.bid ?? null,ask:q.ask ?? null,
      currency:q.currency,name:q.shortName ?? q.longName,marketTime:new Date(q.regularMarketTime).toISOString(),
      realtime:false,sessionVerified:false,halted:true,marketState:q.marketState ?? 'UNKNOWN'}};
  });
  return {items:items.filter(Boolean)};
}

export async function refreshTradeContext(sb,yahoo,symbols,{macro=getMacroCalendar,intelligence=getMarketIntelligence}={}) {
  if (!symbols.length) return;
  const [calendar,research]=await Promise.all([macro({days:7}),intelligence(yahoo,symbols,{includeOptions:false})]);
  checked(await sb.from('trade_context').upsert(symbols.map((symbol)=>({symbol,updated_at:new Date().toISOString(),data:{
    macroEvents:calendar.events ?? [],macroCoverage:calendar.coverage ?? {},
    intelligence:research.items?.find((item)=>item.symbol===symbol) ?? null,
    note:'Makro ve şirket bilgileri araştırma bağlamıdır; lisanslı canlı fiyatın yerine geçmez.',
  }}))));
}

export async function runTradeWorker({sb=automationDb(),env=process.env,yahoo=new YahooFinance({suppressNotices:['yahooSurvey']})}={}) {
  const licensed=Boolean(env.TRADE_FEED_URL && env.TRADE_LICENSED_SOURCE);
  if (env.TRADE_FEED_URL && !env.TRADE_LICENSED_SOURCE) throw new Error('TRADE_LICENSED_SOURCE gerekli.');
  const pollMs=Math.max(500,Math.min(10_000,Number(env.TRADE_POLL_MS)||1000));
  let stopped=false,universe=[],universeAt=0,researchAt=0,contextAt=0,contextCursor=0,refreshing=false;
  let deliveryTask=null;
  // A slow phone must never hold up the next provider snapshot. One bounded
  // sender runs independently and retries only while each signal is fresh.
  const pump=()=>{
    if(stopped || deliveryTask || !env.TRADE_LICENSED_SOURCE) return;
    deliveryTask=deliverNotifications(sb,{topics:['trade']}).catch(()=>console.warn('[trade] Bildirim hizmeti yeniden denenecek.')).finally(()=>{deliveryTask=null;});
  };
  const deliveryTimer=setInterval(pump,500);
  let wake;
  const stop=()=>{stopped=true;wake?.();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try {
    while(!stopped) {
      const cycle=Date.now();
      try {
        if(cycle-universeAt>60_000) {universe=await tradeUniverse(sb);universeAt=cycle;}
        // Slow context refresh runs independently of the quote-to-signal path.
        if(!refreshing && cycle-contextAt>60_000 && universe.length) {
          refreshing=true;contextAt=cycle;
          const selected=universe.slice(contextCursor,contextCursor+5);contextCursor=(contextCursor+5)%universe.length;
          refreshTradeContext(sb,yahoo,selected).catch(()=>console.warn('[trade] Araştırma bağlamı yenilenemedi.')).finally(()=>{refreshing=false;});
        }
        if(licensed && universe.length) {
          const payload=await readTradeFeed(env.TRADE_FEED_URL,env.TRADE_FEED_TOKEN,universe);
          await processTradeBatch(sb,payload,{source:env.TRADE_LICENSED_SOURCE,licensed:true,env,deliver:false});
          pump();
        } else if(!licensed && env.TRADE_RESEARCH_FALLBACK!=='false' && cycle-researchAt>60_000 && universe.length) {
          researchAt=cycle;
          const payload=await researchTradeBatch(yahoo,universe.slice(0,20));
          if(payload.items.length) await processTradeBatch(sb,payload,{source:'Yahoo Finance · gecikmeli araştırma',licensed:false,env,deliver:false});
        }
      } catch {
        await recordMonitor(sb,'trade',{ok:false,running:false,mode:licensed?'licensed-http':'delayed-research',
          source:licensed?env.TRADE_LICENSED_SOURCE:'Yahoo Finance · gecikmeli araştırma',
          message:'Trade bağlantısı veya veri işleme başarısız. Yeni canlı trade üretimi durdu; bağlantı yeniden deneniyor.'}).catch(()=>{});
      }
      const remaining=Math.max(20,pollMs-(Date.now()-cycle));
      await new Promise((resolve)=>{const timer=setTimeout(resolve,remaining);wake=()=>{clearTimeout(timer);resolve();};});
    }
  } finally {clearInterval(deliveryTimer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  runTradeWorker().catch(()=>{console.error('[trade] Worker başlatılamadı; sunucu değişkenlerini ve SQL kurulumunu kontrol edin.');process.exitCode=1;});
}

/** Continuous adapter runner. Hosted Vercel request handlers are not daemons. */
import { pathToFileURL } from 'node:url';
import YahooFinance from 'yahoo-finance2';
import { automationDb, checked, recordMonitor } from './automationDb.js';
import { candidateTradeSymbol, processTradeBatch } from './tradeData.js';
import { deliverNotifications } from './pushNotifications.js';
import { mapLimit } from './concurrency.js';
import { getMacroCalendar } from './macroCalendar.js';
import { getMarketIntelligence } from './marketIntelligence.js';
import { buildDipAlertEvent, collectDipPatterns } from './patternStats.js';
import { buildResearchTradeCandidate } from './tradeEngine.js';

const researchRefreshes = new WeakMap();
const RESEARCH_REFRESH_MS = 60_000;
const RESEARCH_SOURCE = 'Yahoo Finance · gecikmeli araştırma';

function marketTime(value) {
  if (value == null) return NaN;
  const time = value instanceof Date ? value.getTime() : typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  return Number.isFinite(time) ? time : NaN;
}

function boundedYahoo(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Stopped', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function tradeUniverse(sb) {
  const [tracked,candidates]=await Promise.all([
    sb.from('tracked_symbol_queue').select('symbol').order('symbol').limit(100),
    sb.from('candidates').select('symbol,market').eq('horizon','short').order('updated_at',{ascending:false}).limit(100),
  ]);
  // ABD sembolleri ÖNCE gelir: 50 sembollik tavana takıldığında kesilenler
  // BIST tarafı olur (kullanıcı tercihi: trade sekmesi ABD ağırlıklı).
  return [...new Set([...(checked(tracked) ?? []).map((row)=>row.symbol),...(checked(candidates) ?? []).map(candidateTradeSymbol)])]
    .filter((symbol)=>/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol))
    .sort((a,b)=>(a.endsWith('.IS')?1:0)-(b.endsWith('.IS')?1:0))
    .slice(0,50);
}

export async function readTradeFeed(urlValue, token, symbols, {fetcher=fetch,signal} = {}) {
  const url=new URL(urlValue);
  if (url.protocol!=='https:' || url.username || url.password) throw new Error('Trade adaptörü HTTPS kullanmalı; kimlik bilgileri URL içinde olamaz.');
  if (!token) throw new Error('TRADE_FEED_TOKEN gerekli.');
  url.searchParams.set('symbols',symbols.join(','));
  const timeout=AbortSignal.timeout(4000);
  const response=await fetcher(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:signal?AbortSignal.any([signal,timeout]):timeout,redirect:'error'});
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

export async function researchTradeBatch(yahoo,symbols,{now=Date.now(),signal,timeoutMs=6500}={}) {
  if (!symbols.length) return {items:[]};
  const timeout=AbortSignal.timeout(Math.max(100,Math.min(8000,timeoutMs)));
  const requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
  const moduleOptions={fetchOptions:{signal:requestSignal}};
  // Quote and chart requests are independent: an unavailable bulk quote must
  // not hide a perfectly usable, timestamped chart observation for every stock.
  const quoteTask=boundedYahoo(Promise.resolve().then(()=>yahoo.quote(symbols,{},moduleOptions)),requestSignal).catch(()=>[]);
  const chartTask=mapLimit(symbols,3,async(symbol)=>{
    try {
      return await boundedYahoo(Promise.resolve().then(()=>yahoo.chart(symbol,{period1:new Date(now-7*86400000),period2:new Date(now),interval:'1m',includePrePost:false},moduleOptions)),requestSignal);
    } catch { return null; }
  });
  const [raw,charts]=await Promise.all([quoteTask,chartTask]);
  if(signal?.aborted) return {items:[]};
  const quotes=Array.isArray(raw)?raw:[raw];
  const items=symbols.map((symbol,index)=>{
    const q=quotes.find((row)=>row?.symbol===symbol) ?? {},chart=charts[index],meta=chart?.meta ?? {};
    const seen=new Set();
    let bars=(chart?.quotes ?? []).filter((bar)=>Number.isFinite(marketTime(bar.date)) && marketTime(bar.date)+60_000<=now
      && ['open','high','low','close'].every((key)=>typeof bar[key]==='number' && Number.isFinite(bar[key]) && bar[key]>0)
      && typeof bar.volume==='number' && Number.isFinite(bar.volume) && bar.volume>=0
      && bar.high>=Math.max(bar.open,bar.close,bar.low) && bar.low<=Math.min(bar.open,bar.close,bar.high))
      .sort((a,b)=>marketTime(a.date)-marketTime(b.date))
      .filter((bar)=>{const time=marketTime(bar.date);if(seen.has(time)) return false;seen.add(time);return true;})
      .slice(-500).map((bar)=>({time:new Date(marketTime(bar.date)).toISOString(),open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume}));
    const observations=[{price:q.regularMarketPrice,time:marketTime(q.regularMarketTime)},
      {price:meta.regularMarketPrice,time:marketTime(meta.regularMarketTime)}]
      .filter((item)=>Number.isFinite(item.price) && item.price>0 && Number.isFinite(item.time) && item.time<=now+2000)
      .sort((a,b)=>b.time-a.time);
    const observation=observations[0];
    const periods=[meta.currentTradingPeriod?.regular,...[meta.tradingPeriods?.regular ?? meta.tradingPeriods ?? []].flat(4)]
      .filter((item)=>Number.isFinite(marketTime(item?.start)) && Number.isFinite(marketTime(item?.end)) && marketTime(item.end)>marketTime(item.start))
      .sort((a,b)=>marketTime(b.start)-marketTime(a.start));
    const lastRawTime=bars.length?Date.parse(bars.at(-1).time):NaN;
    // Yahoo can append a flat zero-volume row AT the session close. That row
    // is a closing-price sentinel, not a regular one-minute candle. Quote
    // timestamps can also land a second after the close; neither should make
    // us lose the actual session boundaries or include the previous day.
    const period=periods.find((item)=>observation && marketTime(item.start)<=observation.time && observation.time<=marketTime(item.end)+60_000)
      ?? periods.find((item)=>marketTime(item.start)<=lastRawTime && lastRawTime<=marketTime(item.end));
    if(period) bars=bars.filter((bar)=>Date.parse(bar.time)>=marketTime(period.start) && Date.parse(bar.time)<marketTime(period.end));
    const latestBar=bars.at(-1),barTime=latestBar?Date.parse(latestBar.time):NaN;
    // Keep the provider's real timestamp. A completed candle close is an
    // explicitly labelled fallback, never a quote stamped with our fetch time.
    const price=observation?.price ?? latestBar?.close;
    const time=observation?.time ?? barTime+60_000;
    if(!(price>0) || !Number.isFinite(time) || time>now+2000) return null;
    return {symbol,barIntervalSeconds:60,bars,quote:{price,bid:q.bid ?? null,ask:q.ask ?? null,
      currency:q.currency ?? meta.currency,name:q.shortName ?? q.longName ?? meta.shortName ?? meta.longName ?? symbol,
      marketTime:new Date(time).toISOString(),priceBasis:observation?'regular-market-quote':'completed-bar-close',
      realtime:false,sessionVerified:false,marketState:q.marketState ?? 'UNKNOWN',
      sessionStartsAt:period?new Date(marketTime(period.start)).toISOString():null,
      sessionEndsAt:period?new Date(marketTime(period.end)).toISOString():null}};
  });
  return {items:items.filter(Boolean)};
}

/** Bounded request-time research refresh for serverless installations. The
 * durable attempt time rotates failed symbols too and survives cold starts.
 * Existing licensed publication ordering still decides which writes win.
 */
export async function refreshResearchTradeItems(sb,{rows=[],items=[],now=Date.now(),env=process.env,
  yahoo=new YahooFinance({suppressNotices:['yahooSurvey']}),limit=3,monotonic=()=>performance.now()}={}) {
  const requestStarted=monotonic();
  if(env.TRADE_LICENSED_SOURCE || env.TRADE_RESEARCH_FALLBACK==='false') return {items:[],refreshedCount:0,attemptedCount:0};
  if(researchRefreshes.has(sb)) return researchRefreshes.get(sb);
  const task=(async()=>{
    const symbols=[...new Set([...rows.map(candidateTradeSymbol),...items.map((item)=>item.symbol)])]
      .filter((symbol)=>/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)).slice(0,50);
    if(!symbols.length) return {items:[],refreshedCount:0,attemptedCount:0};
    const contexts=checked(await sb.from('trade_context').select('symbol,data').in('symbol',symbols)) ?? [];
    const byContext=new Map(contexts.map((row)=>[row.symbol,row.data ?? {}]));
    const byItem=new Map(items.map((item)=>[item.symbol,item]));
    const selected=symbols.map((symbol)=>({symbol,lastAttempt:Math.max(
      Date.parse(byContext.get(symbol)?.researchAttemptedAt ?? '')||0,
      byItem.get(symbol)?.availability==='delayed-research' ? Date.parse(byItem.get(symbol)?.createdAt ?? '')||0 : 0)}))
      .filter(({lastAttempt})=>now-lastAttempt>=RESEARCH_REFRESH_MS).sort((a,b)=>a.lastAttempt-b.lastAttempt)
      .slice(0,Math.max(1,Math.min(5,Number(limit)||3))).map(({symbol})=>symbol);
    if(!selected.length) return {items:[],refreshedCount:0,attemptedCount:0};
    checked(await sb.from('trade_context').upsert(selected.map((symbol)=>({symbol,updated_at:new Date(now).toISOString(),
      data:{...byContext.get(symbol),researchAttemptedAt:new Date(now).toISOString()}}))));
    const payload=await researchTradeBatch(yahoo,selected,{now});
    if(!payload.items.length) return {items:[],refreshedCount:0,attemptedCount:selected.length};
    const built=new Map();
    // A fetch crossing a minute boundary cannot backdate a newly archived
    // plan into a candle that had already started before the plan existed.
    const decisionClock=()=>now+Math.max(0,Math.ceil(monotonic()-requestStarted));
    const result=await processTradeBatch(sb,payload,{source:RESEARCH_SOURCE,licensed:false,now:decisionClock,env,deliver:false,
      build:(snapshot,options)=>{const candidate=buildResearchTradeCandidate(snapshot,options);built.set(candidate.symbol,candidate);return candidate;}});
    const published=result.items.filter((item)=>item.published).map((item)=>built.get(item.symbol));
    return {items:published,refreshedCount:published.length,attemptedCount:selected.length};
  })();
  researchRefreshes.set(sb,task);
  try{return await task;}finally{researchRefreshes.delete(sb);}
}

export async function refreshTradeContext(sb,yahoo,symbols,{macro=getMacroCalendar,intelligence=getMarketIntelligence,patterns=collectDipPatterns,signal,now=()=>Date.now()}={}) {
  if (!symbols.length || signal?.aborted) return;
  const [calendar,research]=await Promise.all([macro({days:7}),intelligence(yahoo,symbols,{includeOptions:false})]);
  // Slow calendar/company calls may complete after the worker was stopped.
  if (signal?.aborted) return;
  // Tekrarlayan düşüş istatistiği (ücretsiz günlük bar; sembol başına 6 saatte
  // bir yenilenir, aradaki turlar süreç içi önbellekten gelir). İsteğe bağlı
  // araştırma bağlamıdır: hatası bağlam yazımını durdurmaz.
  const dip=await patterns(yahoo,symbols,{now:now(),signal});
  if (signal?.aborted) return;
  // Read immediately before writing: cloud research stores its retry/rotation
  // clock here too. A context refresh must preserve that clock and any other
  // context fields it does not own, including an existing pattern on a miss.
  const existing=checked(await sb.from('trade_context').select('symbol,data').in('symbol',symbols)) ?? [];
  if (signal?.aborted) return;
  const bySymbol=new Map(existing.map((row)=>[row.symbol,row.data ?? {}]));
  checked(await sb.from('trade_context').upsert(symbols.map((symbol)=>({symbol,updated_at:new Date(now()).toISOString(),data:{
    ...bySymbol.get(symbol),
    macroEvents:calendar.events ?? [],macroCoverage:calendar.coverage ?? {},
    intelligence:research.items?.find((item)=>item.symbol===symbol) ?? null,
    ...(dip.bySymbol.has(symbol)?{patternStats:dip.bySymbol.get(symbol)}:{}),
    note:'Makro ve şirket bilgileri araştırma bağlamıdır; lisanslı canlı fiyatın yerine geçmez.',
  }}))));
  if (signal?.aborted) return;
  // Taze + geçmişte işe yaramış düşüşler için bölüm başına TEK bildirim olayı.
  // Kimlik sembol+kova+giriş gününden türediği için tekrar denemeler sessizce
  // yok sayılır. 'pattern' konusu migration ile açılmamışsa ekleme reddedilir;
  // bu, bağlam yenilemeyi düşürmemeli (yalnızca uyarı loglanır).
  const alerts=[...dip.fresh].map((symbol)=>{
    const summary=dip.bySymbol.get(symbol);
    return buildDipAlertEvent({symbol,name:research.items?.find((item)=>item.symbol===symbol)?.name ?? symbol,
      stats:summary?.stats,state:summary?.state,now:new Date(now())});
  }).filter(Boolean);
  if (alerts.length) {
    try { checked(await sb.from('notification_events').upsert(alerts,{onConflict:'id',ignoreDuplicates:true})); }
    catch { console.warn('[trade] Desen bildirimi kaydedilemedi; 20261112_pattern_alerts.sql migration kurulumunu kontrol edin.'); }
  }
}

export async function runTradeWorker({sb=automationDb(),env=process.env,yahoo=new YahooFinance({suppressNotices:['yahooSurvey']}),
  signal,now=()=>Date.now(),sleep,readFeed=readTradeFeed,collectResearch=researchTradeBatch,
  refreshContext=refreshTradeContext,processBatch=processTradeBatch,deliver=deliverNotifications}={}) {
  const source=String(env.TRADE_LICENSED_SOURCE ?? '').trim();
  const sourceConfigured=Boolean(source),pollingFeed=Boolean(env.TRADE_FEED_URL && sourceConfigured);
  const webhookOnly=sourceConfigured && !pollingFeed;
  if (env.TRADE_FEED_URL && !sourceConfigured) throw new Error('TRADE_LICENSED_SOURCE gerekli.');
  const pollMs=Math.max(500,Math.min(10_000,Number(env.TRADE_POLL_MS)||1000));
  let stopped=false,universe=[],universeAt=-Infinity,researchAt=-Infinity,contextAt=-Infinity,contextCursor=0,researchCursor=0,refreshing=false;
  let deliveryTask=null;
  // A slow phone must never hold up the next provider snapshot. One bounded
  // sender runs independently and retries only while each signal is fresh.
  const pump=()=>{
    if(stopped || deliveryTask || !sourceConfigured) return;
    deliveryTask=deliver(sb,{topics:['trade']}).catch(()=>console.warn('[trade] Bildirim hizmeti yeniden denenecek.')).finally(()=>{deliveryTask=null;});
  };
  const deliveryTimer=setInterval(pump,500);
  let wake;
  const feedAbort=new AbortController();
  const stop=()=>{stopped=true;feedAbort.abort();wake?.();};
  const pause=sleep ?? ((ms)=>new Promise((resolve)=>{const timer=setTimeout(resolve,ms);wake=()=>{clearTimeout(timer);resolve();};}));
  const scheduleContextRefresh=(cycle)=>{
    if(stopped || refreshing || cycle-contextAt<60_000) return;
    refreshing=true;contextAt=cycle;
    // Webhook data arrives independently. Optional context work must neither
    // delay that path nor replace its monitor/signal state on a failure.
    (async()=>{
      if(stopped) return;
      const symbols=webhookOnly?await tradeUniverse(sb):universe;
      if(stopped || !symbols.length) return;
      if(contextCursor>=symbols.length) contextCursor=0;
      const selected=symbols.slice(contextCursor,contextCursor+5);
      contextCursor=contextCursor+5>=symbols.length?0:contextCursor+5;
      await refreshContext(sb,yahoo,selected,{signal:feedAbort.signal});
      if(stopped) return;
    })().catch(()=>{if(!stopped) console.warn('[trade] Araştırma bağlamı yenilenemedi.');}).finally(()=>{refreshing=false;});
  };
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  signal?.addEventListener('abort',stop,{once:true});
  if(signal?.aborted) stop();
  try {
    while(!stopped) {
      const cycle=now();
      try {
        // Webhook ingestion owns feed status and signal publication. Only
        // background company/calendar context and push retries run here.
        if(webhookOnly) {scheduleContextRefresh(cycle);pump();}
        else {
          if(cycle-universeAt>=60_000) {universe=await tradeUniverse(sb);universeAt=cycle;}
          if(stopped) break;
          // Slow context refresh runs independently of the quote-to-signal path.
          scheduleContextRefresh(cycle);
          if(pollingFeed && universe.length) {
            const payload=await readFeed(env.TRADE_FEED_URL,env.TRADE_FEED_TOKEN,universe,{signal:feedAbort.signal});
            if(stopped) break;
            await processBatch(sb,payload,{source,licensed:true,env,deliver:false,now});
            pump();
          } else if(!sourceConfigured && env.TRADE_RESEARCH_FALLBACK!=='false' && cycle-researchAt>=60_000 && universe.length) {
            researchAt=cycle;
            if(researchCursor>=universe.length) researchCursor=0;
            const selected=universe.slice(researchCursor,researchCursor+20);
            researchCursor=researchCursor+20>=universe.length?0:researchCursor+20;
            const payload=await collectResearch(yahoo,selected,{now:now(),signal:feedAbort.signal});
            if(stopped) break;
            if(payload.items.length) await processBatch(sb,payload,{source:'Yahoo Finance · gecikmeli araştırma',licensed:false,env,deliver:false,now});
          }
        }
      } catch {
        if(stopped) break;
        await recordMonitor(sb,'trade',{ok:false,running:false,mode:pollingFeed?'licensed-http':'delayed-research',
          heartbeatMaxAgeMs:sourceConfigured?30_000:90_000,
          source:sourceConfigured?source:'Yahoo Finance · gecikmeli araştırma',
          message:'Trade bağlantısı veya veri işleme başarısız. Yeni canlı trade üretimi durdu; bağlantı yeniden deneniyor.'}).catch(()=>{});
      }
      if(stopped) break;
      const remaining=Math.max(20,pollMs-(now()-cycle));
      await pause(remaining);
    }
  } finally {clearInterval(deliveryTimer);feedAbort.abort();signal?.removeEventListener('abort',stop);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  runTradeWorker().catch(()=>{console.error('[trade] Worker başlatılamadı; sunucu değişkenlerini ve SQL kurulumunu kontrol edin.');process.exitCode=1;});
}

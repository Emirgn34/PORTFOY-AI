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
  checked(await sb.from('trade_context').upsert(symbols.map((symbol)=>({symbol,updated_at:new Date().toISOString(),data:{
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
            const payload=await collectResearch(yahoo,selected,{now:now()});
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

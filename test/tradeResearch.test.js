import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchTradeCandidate, isTradeCandidateFresh } from '../server/tradeEngine.js';
import { currentTradeItem } from '../server/tradeData.js';
import { refreshResearchTradeItems, refreshTradeContext, researchTradeBatch } from '../server/tradeWorker.js';

const close = Date.parse('2026-11-13T21:00:00Z');
const now = Date.parse('2026-11-14T10:00:00Z');
const iso = (value) => new Date(value).toISOString();
function snapshot(symbol='TEST') {
  const start=close-60*60_000;
  const bars=Array.from({length:60},(_,i)=>{
    const price=100+i*0.015+Math.sin(i*1.4)*0.09;
    return {time:iso(start+i*60_000),open:price-0.01,high:price+0.09,low:price-0.09,close:price,volume:i>56?20_000:10_000};
  });
  return {symbol,bars,quote:{price:bars.at(-1).close,currency:'USD',marketTime:iso(close),receivedAt:iso(now),
    source:'Yahoo Finance · gecikmeli araştırma',realtime:false,sessionVerified:false,barIntervalSeconds:60,marketState:'CLOSED',
    sessionStartsAt:iso(start),sessionEndsAt:iso(close)}};
}
function yahooFor(symbol='TEST') {
  const data=snapshot(symbol);
  return {async quote(){return [{symbol,regularMarketPrice:data.quote.price,regularMarketTime:new Date(close),currency:'USD',marketState:'CLOSED'}];},
    async chart(){return {meta:{currency:'USD',currentTradingPeriod:{regular:{start:new Date(data.quote.sessionStartsAt),end:new Date(close)}}},
      quotes:data.bars.map((bar)=>({...bar,date:new Date(bar.time)}))};}};
}
function researchDb({publish=true}={}) {
  const contexts=new Map(),published=[],monitors=[];
  return {contexts,published,monitors,async rpc(_name,args){published.push(args);return {data:publish};},from(table){
    let symbols=[];
    return {select(){return this;},in(_key,values){symbols=values;return this;},eq(){return this;},order(){return this;},limit(){return this;},
      async upsert(rows){
        if(table==='trade_context') for(const row of rows) contexts.set(row.symbol,row);
        if(table==='monitor_status') monitors.push(rows);
        return {data:null};
      },then(resolve,reject){const rows=table==='trade_context'?[...contexts.values()].filter((row)=>symbols.includes(row.symbol)):[];
        return Promise.resolve({data:rows}).then(resolve,reject);}};
  }};
}

test('closed-session observations retain real price and research targets without enabling a live signal',()=>{
  const item=buildResearchTradeCandidate(snapshot(),{now});
  assert.equal(item.availability,'delayed-research');assert.equal(item.status,'blocked');
  assert.equal(item.referencePrice,Number(snapshot().quote.price.toFixed(4)));
  assert.equal(item.dataQuality.quoteTime,iso(close));assert.equal(item.dataQuality.realtime,false);
  assert.equal(item.dataQuality.halted,null);assert.equal(isTradeCandidateFresh(item,now),false);
  assert.equal(item.scenarios.length,3);assert.ok(item.scenarios.every((scenario)=>scenario.eligible===false));
  assert.ok(item.entry>item.stopLoss);assert.ok(item.metrics.atr14>0);assert.equal(item.metrics.costAssumed,true);
  assert.ok(item.metrics.estimatedCostPerShare>0);assert.equal(item.metrics.spreadBps,null);
  assert.ok(item.warnings.some((message)=>message.includes('Alış/satış farkı alınamadı')));
});

test('research never fabricates price, currency, or a plan from a future quote or insufficient bars',()=>{
  for(const patch of [{price:null},{currency:'TRY'},{marketTime:iso(now+3000)},{marketTime:undefined}]) {
    const input=snapshot();Object.assign(input.quote,patch);
    const item=buildResearchTradeCandidate(input,{now});
    assert.equal(item.referencePrice,null);assert.deepEqual(item.scenarios,[]);assert.equal(isTradeCandidateFresh(item,now),false);
  }
  const input=snapshot();input.bars=[];
  const item=buildResearchTradeCandidate(input,{now});
  assert.ok(item.referencePrice>0);assert.deepEqual(item.scenarios,[]);assert.equal(item.stopLoss,null);
});

test('unfinished bars do not influence research indicators and an old quote is never restamped',()=>{
  const input=snapshot(),base=buildResearchTradeCandidate(input,{now});
  input.bars.push({time:iso(now-5000),open:1000,high:1500,low:900,close:1200,volume:1e9});
  assert.deepEqual(buildResearchTradeCandidate(input,{now}).metrics,base.metrics);
  input.quote.marketTime=iso(now-10*86400000);
  const old=buildResearchTradeCandidate(input,{now});
  assert.equal(old.dataQuality.quoteTime,input.quote.marketTime);assert.deepEqual(old.scenarios,[]);
});

test('bulk quote failure still returns each valid chart observation with the actual closed-bar timestamp',async()=>{
  const yahoo=yahooFor();yahoo.quote=async()=>{throw new Error('Quote endpoint unavailable');};
  const result=await researchTradeBatch(yahoo,['TEST','SECOND'],{now});
  assert.deepEqual(result.items.map((item)=>item.symbol),['TEST','SECOND']);
  assert.ok(result.items.every((item)=>item.quote.marketTime===iso(close) && item.quote.priceBasis==='completed-bar-close'));
  assert.ok(result.items.every((item)=>item.bars.length===60 && item.quote.realtime===false && item.quote.sessionVerified===false));
});

test('chart metadata quote survives individual symbol failure, excludes unfinished and malformed bars',async()=>{
  const yahoo=yahooFor();const originalChart=yahoo.chart;
  yahoo.quote=async()=>[];
  yahoo.chart=async(symbol)=>{
    if(symbol==='BROKEN') throw new Error('Symbol unavailable');
    const chart=await originalChart();
    chart.meta.regularMarketPrice=123;chart.meta.regularMarketTime=new Date(close);
    chart.quotes.push({...chart.quotes[0]},{date:new Date(now),open:1,high:2,low:0.5,close:1,volume:10},
      {date:new Date(now-60_000),open:1,high:0.5,low:2,close:1,volume:10});
    return chart;
  };
  const result=await researchTradeBatch(yahoo,['TEST','BROKEN'],{now});
  assert.equal(result.items.length,1);assert.equal(result.items[0].quote.price,123);
  assert.equal(result.items[0].quote.marketTime,iso(close));assert.equal(result.items[0].bars.length,60);
});

test('real Yahoo close sentinel and numeric nested trading periods keep exactly the last regular session',async()=>{
  const start=close-390*60_000;
  const quoteTime=close+1000;
  const session=Array.from({length:390},(_,index)=>({date:new Date(start+index*60_000),open:356.2,high:356.4,low:356.1,close:356.27,
    volume:index===388?286434:index===389?725503:100000}));
  const prior=Array.from({length:200},(_,index)=>({...session[0],date:new Date(start-86400000+index*60_000)}));
  const sentinel={date:new Date(close),open:356.27,high:356.27,low:356.27,close:356.27,volume:0};
  const chart={meta:{currency:'USD',regularMarketPrice:356.27,regularMarketTime:new Date(quoteTime),
    currentTradingPeriod:{regular:{start:new Date(start),end:new Date(close)}},
    tradingPeriods:[[{start:start/1000,end:close/1000}]]},quotes:[...prior,...session,sentinel]};
  const yahoo={async quote(){return [{symbol:'TEST',currency:'USD',regularMarketPrice:356.26,regularMarketTime:new Date(close-1000)}];},async chart(){return chart;}};
  const result=await researchTradeBatch(yahoo,['TEST'],{now});
  const item=result.items[0];
  assert.equal(item.bars.length,390);assert.equal(item.bars[0].time,iso(start));assert.equal(item.bars.at(-1).time,iso(close-60_000));
  assert.equal(item.quote.sessionStartsAt,iso(start));assert.equal(item.quote.sessionEndsAt,iso(close));
  assert.equal(item.quote.price,356.27);assert.equal(item.quote.marketTime,iso(quoteTime));
  const observation=buildResearchTradeCandidate(item,{now});
  assert.equal(observation.dataQuality.barTime,iso(close));assert.equal(observation.metrics.barsUsed,390);
  // With no quote/meta price, the genuine 20:59 candle closes at 21:00;
  // the sentinel must never become a synthetic 21:00–21:01 candle.
  delete chart.meta.regularMarketPrice;delete chart.meta.regularMarketTime;
  delete chart.meta.currentTradingPeriod;
  yahoo.quote=async()=>[];
  const fallback=(await researchTradeBatch(yahoo,['TEST'],{now})).items[0];
  assert.equal(fallback.bars.length,390);assert.equal(fallback.quote.marketTime,iso(close));
  assert.equal(fallback.quote.priceBasis,'completed-bar-close');assert.equal(fallback.quote.sessionEndsAt,iso(close));
});

test('research cancellation bounds both concurrent provider calls, even if the provider ignores its AbortSignal',async()=>{
  const controller=new AbortController(),pending=()=>new Promise(()=>{});
  const timer=setTimeout(()=>controller.abort(),20),started=Date.now();
  try {
    const result=await researchTradeBatch({quote:pending,chart:pending},['TEST'],{now,signal:controller.signal});
    assert.deepEqual(result.items,[]);assert.ok(Date.now()-started<500);
  }finally{clearTimeout(timer);}
});

test('cloud research publishes only observation snapshots and returns only database-accepted items',async()=>{
  for(const publish of [true,false]) {
    const db=researchDb({publish});
    const result=await refreshResearchTradeItems(db,{rows:[{symbol:'TEST'}],items:[],env:{},now,yahoo:yahooFor()});
    assert.equal(result.items.length,publish?1:0);assert.equal(db.published.length,1);
    assert.equal(db.published[0].p_realtime,false);assert.equal(db.published[0].p_signal.status,'blocked');
    assert.equal(db.published[0].p_quote_time,iso(close));assert.equal(db.contexts.get('TEST').data.researchAttemptedAt,iso(now));
  }
});

test('durable failed-attempt timestamps rotate all symbols and prevent request-time retry storms',async()=>{
  const db=researchDb(),calls=[];
  const yahoo={async quote(symbols){calls.push(symbols);return [];},async chart(){throw new Error('Unavailable');}};
  const args={rows:['FIRST','SECOND','THIRD'].map((symbol)=>({symbol})),env:{},now,yahoo,limit:1};
  for(let i=0;i<5;i++) await refreshResearchTradeItems(db,args);
  assert.deepEqual(calls,[['FIRST'],['SECOND'],['THIRD']]);assert.equal(db.published.length,0);
  assert.ok([...db.contexts.values()].every((row)=>row.data.researchAttemptedAt===iso(now)));
  const retry=await refreshResearchTradeItems(db,{...args,now:now+60_000});
  assert.equal(retry.attemptedCount,1);assert.deepEqual(calls.at(-1),['FIRST']);
});

test('cloud research never contacts Yahoo when a licensed source is configured or fallback is disabled',async()=>{
  const db={from(){assert.fail('No SQL read needed.');}},yahoo={quote(){assert.fail('No Yahoo call allowed.');}};
  for(const env of [{TRADE_LICENSED_SOURCE:'Licensed'},{TRADE_RESEARCH_FALLBACK:'false'}])
    assert.deepEqual(await refreshResearchTradeItems(db,{rows:[{symbol:'TEST'}],env,now,yahoo}),{items:[],refreshedCount:0,attemptedCount:0});
});

test('worker context refresh preserves durable research cooldowns, prior pattern and fields it does not own',async()=>{
  const db=researchDb();
  db.contexts.set('TEST',{symbol:'TEST',data:{researchAttemptedAt:iso(now),patternStats:{updatedAt:iso(close),stats:{count:9}},custom:{kept:true},
    intelligence:{old:true},macroEvents:[{title:'old'}]}});
  await refreshTradeContext(db,{},['TEST'],{now:()=>now,
    macro:async()=>({events:[{title:'new'}],coverage:{verified:false}}),
    intelligence:async()=>({items:[{symbol:'TEST',name:'Fresh company'}]}),
    patterns:async()=>({bySymbol:new Map(),fresh:[]})});
  const row=db.contexts.get('TEST');
  assert.equal(row.data.researchAttemptedAt,iso(now));assert.deepEqual(row.data.custom,{kept:true});
  assert.deepEqual(row.data.patternStats,{updatedAt:iso(close),stats:{count:9}});
  assert.deepEqual(row.data.macroEvents,[{title:'new'}]);assert.equal(row.data.intelligence.name,'Fresh company');
  assert.equal(row.updated_at,iso(now));
});

test('saved blocked research loses stale video highlights on reads, including nested confirmed setups',()=>{
  const saved={symbol:'TEST',status:'blocked',availability:'delayed-research',scenarios:[{eligible:false}],
    videoStrategies:[{id:'strategy',state:'confirmed',dataStatus:'recent',dataMode:'research',actionable:false,
      evaluatedAt:iso(now),lastBarTime:iso(now-60_000),reasons:['A geometric pattern was confirmed.'],
      setups:[{id:'long',state:'confirmed',actionable:false},{id:'short',state:'zone',actionable:false}]}]};
  const fresh=currentTradeItem(saved,now);
  assert.equal(fresh.videoStrategies[0].state,'confirmed');
  const stale=currentTradeItem(saved,now+5*60_000+1);
  assert.equal(stale.status,'blocked');assert.equal(stale.videoStrategies[0].state,'waiting');
  assert.equal(stale.videoStrategies[0].dataStatus,'stale');
  assert.ok(stale.videoStrategies[0].setups.every((setup)=>setup.state==='waiting'));
  assert.equal(saved.videoStrategies[0].state,'confirmed','Read-time expiry does not mutate saved snapshots.');
  assert.equal(saved.videoStrategies[0].setups[0].state,'confirmed');
});

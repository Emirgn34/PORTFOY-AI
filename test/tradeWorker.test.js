import test from 'node:test';
import assert from 'node:assert/strict';
import {readTradeFeed,refreshTradeContext,runTradeWorker} from '../server/tradeWorker.js';

function workerDb(symbols=[]) {
  const monitors=[];
  return {monitors,from(table){
    if(table==='monitor_status') return {async upsert(row){monitors.push(row);return {data:null};}};
    const rows=table==='tracked_symbol_queue'?symbols.map((symbol)=>({symbol})):[];
    const query={select(){return this;},order(){return this;},eq(){return this;},limit(){return this;},then(resolve,reject){return Promise.resolve({data:rows}).then(resolve,reject);}};
    return query;
  }};
}

test('webhook-only worker refreshes rotating company context and retries push without quote fallback or signal/status writes',async()=>{
  const controller=new AbortController(),symbols=Array.from({length:12},(_,index)=>`SYM${index}`),db=workerDb(symbols),contexts=[];
  let deliveries=0,clock=Date.parse('2026-11-11T16:00:00Z');
  const unexpected=async()=>assert.fail('Webhook-only worker must not collect or publish quote research.');
  await runTradeWorker({sb:db,
    env:{TRADE_LICENSED_SOURCE:'Licensed webhook',TRADE_RESEARCH_FALLBACK:'true'},yahoo:{quote:unexpected,chart:unexpected},signal:controller.signal,now:()=>clock,
    readFeed:unexpected,collectResearch:unexpected,processBatch:unexpected,
    refreshContext:async(_sb,_yahoo,selected,options)=>{assert.equal(options.signal.aborted,false);contexts.push(selected);},
    deliver:async(_sb,options)=>{deliveries++;assert.deepEqual(options.topics,['trade']);},
    sleep:async()=>{await new Promise((resolve)=>setImmediate(resolve));clock+=60_000;if(contexts.length===3) controller.abort();}});
  assert.ok(deliveries>=1);assert.deepEqual(contexts.map((batch)=>batch.length),[5,5,2]);
  assert.deepEqual(contexts.flat(),symbols);assert.equal(db.monitors.length,0);
});

test('webhook context lookup failure remains optional and cannot overwrite the incoming feed status',async()=>{
  const controller=new AbortController(),db=workerDb(['AAPL']);
  const originalFrom=db.from;db.from=(table)=>{
    if(table==='tracked_symbol_queue') throw new Error('Optional context unavailable');
    return originalFrom(table);
  };
  await runTradeWorker({sb:db,env:{TRADE_LICENSED_SOURCE:'Licensed webhook'},yahoo:{},signal:controller.signal,
    refreshContext:async()=>assert.fail('No context refresh follows a failed lookup.'),deliver:async()=>{},
    processBatch:async()=>assert.fail('Webhook worker never publishes signals.'),
    sleep:async()=>{await new Promise((resolve)=>setImmediate(resolve));controller.abort();}});
  assert.equal(db.monitors.length,0);
});

test('context results arriving after shutdown cannot write a stale company/calendar snapshot',async()=>{
  const controller=new AbortController();let release;
  const pending=new Promise((resolve)=>{release=resolve;});let writes=0;
  const refreshing=refreshTradeContext({from(){writes++;assert.fail('Stopped context must not write.');}},{},['AAPL'],{
    signal:controller.signal,macro:async()=>pending,intelligence:async()=>({items:[]}),
  });
  controller.abort();release({events:[]});await refreshing;assert.equal(writes,0);
});

test('research worker rotates bounded batches through every one of fifty symbols',async()=>{
  const symbols=Array.from({length:50},(_,index)=>`SYM${String(index).padStart(2,'0')}`);
  const db=workerDb(symbols),controller=new AbortController(),batches=[];
  let clock=Date.parse('2026-11-11T16:00:00Z');
  const yahoo={async quote(requested){return requested.map((symbol)=>({symbol,regularMarketPrice:100,
    regularMarketTime:new Date(clock),currency:'USD',marketState:'REGULAR'}));},async chart(){return {quotes:[]};}};
  await runTradeWorker({sb:db,env:{TRADE_RESEARCH_FALLBACK:'true'},yahoo,signal:controller.signal,now:()=>clock,
    refreshContext:async()=>{},deliver:async()=>assert.fail('Unlicensed research must not run the trade sender.'),
    processBatch:async(_sb,payload,options)=>{
      assert.equal(options.licensed,false);assert.equal(options.deliver,false);
      assert.ok(payload.items.every((item)=>item.quote.realtime===false && item.quote.sessionVerified===false));
      batches.push(payload.items.map((item)=>item.symbol));
    },sleep:async()=>{clock+=60_000;if(batches.length===4) controller.abort();}});
  assert.deepEqual(batches.map((batch)=>batch.length),[20,20,10,20]);
  assert.deepEqual(batches.slice(0,3).flat(),symbols);
  assert.deepEqual(batches[3],symbols.slice(0,20));
  assert.equal(db.monitors.length,0);
});

test('shutdown during a pending licensed feed aborts it without publishing, failure status or another sleep',async()=>{
  const db=workerDb(['AAPL']),controller=new AbortController();let started;
  const providerStarted=new Promise((resolve)=>{started=resolve;});let sleeps=0,published=0;
  const worker=runTradeWorker({sb:db,env:{TRADE_LICENSED_SOURCE:'Licensed feed',TRADE_FEED_URL:'https://feed.invalid'},yahoo:{},signal:controller.signal,
    refreshContext:async()=>{},deliver:async()=>{},processBatch:async()=>{published++;},sleep:async()=>{sleeps++;},
    readFeed:async(_url,_token,_symbols,{signal})=>{
      started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true}));
    }});
  await providerStarted;controller.abort();await worker;
  assert.equal(published,0);assert.equal(sleeps,0);assert.equal(db.monitors.length,0);
});

test('shutdown while research is pending discards its result and skips another sleep',async()=>{
  const db=workerDb(['AAPL']),controller=new AbortController();let published=0,sleeps=0;
  await runTradeWorker({sb:db,env:{},yahoo:{},signal:controller.signal,refreshContext:async()=>{},
    collectResearch:async()=>{controller.abort();return {items:[{symbol:'AAPL'}]};},
    processBatch:async()=>{published++;},sleep:async()=>{sleeps++;}});
  assert.equal(published,0);assert.equal(sleeps,0);assert.equal(db.monitors.length,0);
});

test('provider failures report unhealthy status with the correct mode heartbeat limit',async()=>{
  for(const licensed of [false,true]) {
    const db=workerDb(['AAPL']),controller=new AbortController();
    const fail=async()=>{throw new Error('Provider unreachable');};
    await runTradeWorker({sb:db,env:licensed?{TRADE_LICENSED_SOURCE:'Licensed feed',TRADE_FEED_URL:'https://feed.invalid'}:{},
      yahoo:{},signal:controller.signal,refreshContext:async()=>{},readFeed:fail,collectResearch:fail,deliver:async()=>{},
      sleep:async()=>controller.abort()});
    assert.equal(db.monitors.length,1);assert.equal(db.monitors[0].data.ok,false);assert.equal(db.monitors[0].data.running,false);
    assert.equal(db.monitors[0].data.heartbeatMaxAgeMs,licensed?30_000:90_000);
    assert.equal(db.monitors[0].data.mode,licensed?'licensed-http':'delayed-research');
  }
});

test('HTTP adapter combines worker shutdown with its provider timeout signal',async()=>{
  const controller=new AbortController();let started;
  const providerStarted=new Promise((resolve)=>{started=resolve;});
  const request=readTradeFeed('https://feed.invalid','server-token',['AAPL'],{signal:controller.signal,
    fetcher:async(_url,options)=>{started();return new Promise((_resolve,reject)=>{
      options.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true});
    });}});
  await providerStarted;controller.abort();await assert.rejects(request,{name:'AbortError'});
});

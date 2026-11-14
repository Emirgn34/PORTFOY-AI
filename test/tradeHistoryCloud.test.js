import test from 'node:test';
import assert from 'node:assert/strict';
import { scanCloudTradeHistory } from '../server/tradeHistoryCloud.js';
import { createNewsScannerHandler } from '../server/newsScannerApi.js';
import { processTradeBatch } from '../server/tradeData.js';

const clock = Date.parse('2026-11-14T16:00:00Z');
function cloudDb(error) {
  let monitor = null;
  return { get monitor() { return monitor; }, from(table) {
    return { select() { return this; }, limit() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: monitor }; },
      async upsert(row) { monitor = row; return { data: null }; },
      then(resolve,reject) { return Promise.resolve(table === 'trade_history' ? { data: [], error } : { data: [] }).then(resolve,reject); } };
  } };
}

test('missing history migration makes cloud collection idle before any provider request', async () => {
  const sb = cloudDb({ code: '42P01', message: 'relation trade_history does not exist' });
  const unexpected = () => assert.fail('No source or universe request before installation.');
  const result = await scanCloudTradeHistory(sb, { collect: unexpected, universe: unexpected, loadPending: unexpected });
  assert.equal(result.installationRequired, true);
  await assert.rejects(scanCloudTradeHistory(cloudDb({ code: '42501', message: 'permission denied' })), /veritabanına/);
});

test('cloud cron archives without a page request and rotates persisted attempts across cold starts', async () => {
  const sb = cloudDb(), batches = [];
  const options = { now: clock, env: {}, universe: async () => ['A','B','C','D','E','F','G'], loadPending: async () => [],
    collect: async (_yahoo,symbols,opts) => { assert.equal(opts.timeoutMs,4500); batches.push(symbols); return { items: symbols.map((symbol) => ({ symbol })) }; },
    processBatch: async (_db,payload,opts) => {
      assert.equal(opts.licensed,false); assert.equal(opts.deliver,false);
      return { items: payload.items.map((item) => ({ ...item,history:{available:true} })) };
    } };
  await scanCloudTradeHistory(sb, options);
  await scanCloudTradeHistory(sb, { ...options,now:clock+60_000 });
  assert.deepEqual(batches, [['A','B','C','D','E'],['F','G','A','B','C']]);
  assert.equal(sb.monitor.id,'trade-history');
  assert.equal(sb.monitor.data.checkedCount,5);
});

test('licensed installations never publish Yahoo research or score live records with its candles', async () => {
  const sb=cloudDb(),calls=[];
  await scanCloudTradeHistory(sb,{now:clock,env:{TRADE_LICENSED_SOURCE:'Feed'},
    universe:async()=>assert.fail('No new research universe with licensed feed.'),
    loadPending:async(_db,{mode})=>mode==='research'?['AAPL']:['MSFT'],
    collect:async()=>({items:[{symbol:'AAPL',bars:[],quote:{price:100,currency:'USD',marketTime:new Date(clock).toISOString()}}]}),
    processBatch:async()=>assert.fail('Research must not replace feed health/publication.'),
    sync:async(_db,candidate,snapshot,opts)=>{calls.push({candidate,snapshot,opts});return {available:true};}});
  assert.equal(calls.length,2);
  const live=calls.find((call)=>call.snapshot.symbol==='MSFT');
  assert.equal(live.snapshot.quote.realtime,true);assert.deepEqual(live.snapshot.bars,[]);
  const research=calls.find((call)=>call.snapshot.symbol==='AAPL');
  assert.equal(research.snapshot.quote.realtime,false);
  assert.ok(calls.every((call)=>call.candidate===null && call.opts.createPlans===false));
});

test('a fetch crossing a minute boundary cannot backdate the new plan into that partial minute', async () => {
  let elapsed=0,publicationTime;
  const started=Date.parse('2026-11-14T16:00:59Z');
  await scanCloudTradeHistory(cloudDb(),{now:started,monotonic:()=>elapsed,env:{},
    loadPending:async()=>[],universe:async()=>['AAPL'],
    collect:async()=>{elapsed=2500;return {items:[{symbol:'AAPL'}]};},
    processBatch:async(_db,_payload,options)=>{publicationTime=options.now();return {items:[]};}});
  assert.equal(publicationTime,Date.parse('2026-11-14T16:01:01.500Z'));
  assert.equal(new Date(Math.ceil(publicationTime/60_000)*60_000).toISOString(),'2026-11-14T16:02:00.000Z');
});

test('failed provider rotates too and passes empty evidence for honest timeout handling', async () => {
  const sb=cloudDb(),calls=[];
  const result=await scanCloudTradeHistory(sb,{now:clock,env:{TRADE_RESEARCH_FALLBACK:'false'},
    loadPending:async(_db,{mode})=>mode==='research'?['AAPL']:[],
    collect:async()=>{throw new Error('Provider offline');},
    sync:async(_db,candidate,snapshot,opts)=>{calls.push({candidate,snapshot,opts});return {available:true};}});
  assert.equal(result.failed,1);assert.equal(calls.length,1);
  assert.deepEqual(calls[0].snapshot.bars,[]);assert.equal(calls[0].opts.createPlans,false);
  assert.equal(sb.monitor.data.attempts.AAPL,new Date(clock).toISOString());
  assert.equal(sb.monitor.data.ok,false);
});

test('history automation failure leaves a successful authenticated news cron successful', async () => {
  const secret='s'.repeat(40);let called=0;
  const handler=createNewsScannerHandler({env:{CRON_SECRET:secret},getDb:()=>({}),
    scan:async()=>({feeds:['source']}),translate:async()=>{},refreshHedge:async()=>{},scanPatterns:async()=>{},
    scanTradeHistory:async(_db,{env})=>{called++;assert.equal(env.CRON_SECRET,secret);throw new Error('Offline');}});
  const res={code:200,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler({method:'POST',headers:{'x-cron-secret':secret},body:{}},res);
  assert.equal(called,1);assert.equal(res.code,200);assert.equal(res.body.ok,true);
});

test('history persistence failure cannot interrupt an already committed signal or push', async () => {
  const order=[];
  const sb={from(table){return {select(){return this;},in(){return this;},eq(){return this;},order(){return this;},limit(){return this;},
    async upsert(){return {data:null};},then(resolve,reject){return Promise.resolve({data:[]}).then(resolve,reject);}};},
  async rpc(name){assert.equal(name,'publish_trade_signal');order.push('signal');return {data:true};}};
  const result=await processTradeBatch(sb,{items:[{symbol:'AAPL',bars:[],quote:{price:100,currency:'USD',marketTime:new Date(clock).toISOString()}}]},
    {source:'Research',now:()=>clock,build:()=>({symbol:'AAPL',status:'blocked'}),
      history:async()=>{order.push('history');throw new Error('DB history unavailable');},
      deliver:async()=>{order.push('push');return {ok:true};}});
  assert.deepEqual(order,['signal','history','push']);
  assert.equal(result.items[0].published,true);assert.equal(result.items[0].history.error,true);
});

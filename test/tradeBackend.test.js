import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {normalizeTradeBatch,currentTradeItem,processTradeBatch,candidateTradeSymbol,loadTradeContexts} from '../server/tradeData.js';
import {buildTradeCandidate} from '../server/tradeEngine.js';
import {createTradeHandler} from '../server/tradeApi.js';
import {readTradeFeed,tradeUniverse} from '../server/tradeWorker.js';

const clock=Date.parse('2026-11-11T15:30:00Z');
const payload=()=>({items:[{symbol:'AAPL',barIntervalSeconds:60,quote:{price:100,bid:99.99,ask:100.01,currency:'USD',
  marketTime:new Date(clock-1000).toISOString(),sessionStartsAt:'2026-11-11T14:30:00Z',sessionEndsAt:'2026-11-11T21:00:00Z',
  marketState:'REGULAR',realtime:true,sessionVerified:true,halted:false},bars:[{time:'2026-11-11T15:29:00Z',open:100,high:101,low:99,close:100,volume:5000}]}]});
const normalize=(value,licensed=true)=>normalizeTradeBatch(value,{source:'LicensedAdapter',licensed,now:clock});

test('trade normalizer preserves verified time/currency/session and cannot promote delayed data',()=>{
  const licensed=normalize(payload())[0];
  assert.equal(licensed.quote.realtime,true);assert.equal(licensed.quote.receivedAt,new Date(clock).toISOString());
  assert.equal(licensed.quote.sessionStartsAt,'2026-11-11T14:30:00.000Z');
  assert.equal(licensed.quote.barIntervalSeconds,60);
  const delayed=normalize(payload(),false)[0];
  assert.equal(delayed.quote.realtime,false);assert.equal(delayed.quote.sessionVerified,false);
  const missing=payload();delete missing.items[0].quote.currency;delete missing.items[0].quote.halted;
  const unknown=normalize(missing)[0];assert.equal(unknown.quote.currency,null);assert.equal(unknown.quote.halted,true);
  const timezone=payload();timezone.items[0].quote.marketTime='2026-11-11T15:30:00';
  assert.throws(()=>normalize(timezone),/ISO/);
  const duplicate=payload();duplicate.items.push(duplicate.items[0]);assert.throws(()=>normalize(duplicate),/tekil/);
  const future=payload();future.items[0].quote.marketTime=new Date(clock+5000).toISOString();assert.throws(()=>normalize(future),/Gelecek/);
  const unordered=payload();unordered.items[0].bars.push({...unordered.items[0].bars[0]});assert.throws(()=>normalize(unordered),/artan/);
});

test('normalized licensed snapshots reach the real engine; delayed snapshots cannot become ready',()=>{
  const data=payload();
  data.items[0].bars=Array.from({length:60},(_,i)=>{
    const close=100+i*0.015+Math.sin(i*1.4)*0.09;
    return {time:new Date(clock-3_600_000+i*60_000).toISOString(),open:close-0.01,high:close+0.09,low:close-0.09,close,volume:i>56?20_000:10_000};
  });
  const price=data.items[0].bars.at(-1).close;
  Object.assign(data.items[0].quote,{price,bid:price-0.01,ask:price+0.01});
  const actual=buildTradeCandidate(normalize(data)[0],{now:clock});
  assert.deepEqual(actual.blockers,[]);assert.equal(actual.status,'ready');
  const delayed=buildTradeCandidate(normalize(data,false)[0],{now:clock});
  assert.equal(delayed.status,'blocked');
});

test('expired saved trades become blocked dynamically and scenario eligibility is revoked',()=>{
  const ready={status:'ready',expiresAt:new Date(clock-1).toISOString(),blockers:[],scenarios:[{eligible:true}]};
  const expired=currentTradeItem(ready,clock);assert.equal(expired.status,'blocked');assert.equal(expired.scenarios[0].eligible,false);
  assert.equal(ready.status,'ready');assert.equal(currentTradeItem({status:'watch'},clock).status,'watch');
});

function resultDb(tables={}) {
  const writes=[];const authCalls=[];
  return {writes,authCalls,auth:{async getUser(token){authCalls.push(token);return {data:{user:token==='valid'?{id:'owner'}:null}};}},from(name){
    let filters=[],single=false;
    const query={select(){return this;},eq(key,value){filters.push([key,value]);return this;},in(){return this;},order(){return this;},limit(){return this;},maybeSingle(){single=true;return this;},
      upsert(value){writes.push({name,value});return Promise.resolve({data:null});},then(resolve,reject){let value=tables[name] ?? [];
        value=value.filter((row)=>filters.every(([key,v])=>row[key]===v));return Promise.resolve({data:single?value[0]??null:value}).then(resolve,reject);}};return query;
  },async rpc(name,args){writes.push({name,args});return {data:true};}};
}
const response=()=>({statusCode:200,headers:{},setHeader(key,value){this.headers[key]=value;},status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}});

test('BIST candidates keep Yahoo suffix in universe, context lookup and fallback cards',async()=>{
  assert.equal(candidateTradeSymbol({symbol:'THYAO',market:'BIST'}),'THYAO.IS');
  assert.equal(candidateTradeSymbol({symbol:'THYAO.IS',market:'BIST'}),'THYAO.IS');
  assert.equal(candidateTradeSymbol({symbol:'AAPL',market:'NASDAQ'}),'AAPL');
  const db=resultDb({tracked_symbol_queue:[{symbol:'THYAO.IS'}],candidates:[{symbol:'THYAO',market:'BIST',horizon:'short',data:{companyName:'Türk Hava Yolları'},updated_at:new Date(clock).toISOString()}]});
  assert.deepEqual(await tradeUniverse(db),['THYAO.IS']);
  const context=(await loadTradeContexts(db,['THYAO.IS'])).get('THYAO.IS');
  assert.equal(context.candidate.companyName,'Türk Hava Yolları');
  const handler=createTradeHandler({getDb:()=>db,now:()=>clock});
  const res=response();await handler({method:'GET',query:{action:'state'},headers:{authorization:'Bearer valid'}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.items[0].symbol,'THYAO.IS');
  assert.equal(res.body.items[0].market,'BIST');assert.equal(res.body.items[0].name,'Türk Hava Yolları');
  assert.equal(res.body.items[0].status,'blocked');
});

test('trade API authenticates users, derives owner from JWT, and separates feed credential',async()=>{
  const db=resultDb();let ingested=0;
  const handler=createTradeHandler({getDb:()=>db,env:{TRADE_INGEST_SECRET:'x'.repeat(32),TRADE_LICENSED_SOURCE:'Feed'},now:()=>clock,
    processBatch:async()=>{ingested++;return {items:[]};}});
  const request=async(method,action,body={},headers={})=>{const res=response();await handler({method,query:{action,user_id:'someone-else'},body,headers},res);return res;};
  assert.equal((await request('GET','state')).statusCode,401);assert.equal(db.authCalls.length,0);
  assert.equal((await request('POST','ingest',{}, {authorization:'Bearer valid'})).statusCode,401);assert.equal(ingested,0);
  assert.equal((await request('POST','ingest',{}, {'x-trade-secret':'x'.repeat(32)})).statusCode,200);assert.equal(ingested,1);
  const saved=await request('POST','preferences',{enabled:true,user_id:'someone-else'},{authorization:'Bearer valid'});
  assert.equal(saved.statusCode,200);assert.deepEqual(saved.body.preferences,{enabled:true});
  assert.equal(db.writes[0].value.user_id,'owner');
  assert.equal((await request('POST','preferences',{enabled:'true'},{authorization:'Bearer valid'})).statusCode,400);
  const state=await request('GET','state',{}, {authorization:'Bearer valid'});
  assert.equal(state.statusCode,200);assert.equal(state.body.status.running,false);assert.deepEqual(state.body.items,[]);
  assert.equal(state.body.requirements.find((r)=>r.id==='context').status,'partial');
});

test('trade publication is durable before notification provider is contacted',async()=>{
  const db=resultDb();const events=[];
  db.rpc=async()=>{events.push('commit');return {data:true};};
  const result=await processTradeBatch(db,payload(),{source:'Feed',licensed:true,now:()=>clock,
    build:({quote})=>({symbol:'AAPL',status:quote.realtime?'ready':'blocked'}),deliver:async()=>{events.push('push');throw new Error('provider down');}});
  assert.deepEqual(events,['commit','push']);assert.equal(result.items[0].published,true);assert.ok(result.delivery.error);
});

test('normalized HTTP feed uses HTTPS, bearer header, no redirects and bounded JSON',async()=>{
  await assert.rejects(readTradeFeed('http://feed.invalid','token',['AAPL']),/HTTPS/);
  await assert.rejects(readTradeFeed('https://user:pass@feed.invalid','token',['AAPL']),/HTTPS/);
  await assert.rejects(readTradeFeed('https://feed.invalid','',['AAPL']),/TOKEN/);
  const data=await readTradeFeed('https://feed.invalid/data','server-secret',['AAPL'],{fetcher:async(url,init)=>{
    assert.equal(url.searchParams.get('symbols'),'AAPL');assert.equal(init.headers.Authorization,'Bearer server-secret');assert.equal(init.redirect,'error');return Response.json(payload());
  }});assert.equal(data.items[0].symbol,'AAPL');
});

async function database() {
  const db=new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key);');
  await db.exec(await readFile(new URL('../supabase/automation-schema.sql',import.meta.url),'utf8'));
  const migration=await readFile(new URL('../supabase/migrations/20261111_trade.sql',import.meta.url),'utf8');
  await db.exec(migration);await db.exec(migration);
  return db;
}

test('SQL trade publication and opt-in outbox are atomic, idempotent and isolated',async()=>{
  const db=await database();
  try {
    const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
    await db.query('insert into auth.users values($1),($2)',[owner,other]);
    await db.query('insert into trade_preferences(user_id,enabled) values($1,true),($2,false)',[owner,other]);
    await db.query("insert into push_subscriptions(user_id,endpoint,subscription,topics) values($1,'https://web.push.apple.com/owner','{}',array['trade']),($2,'https://web.push.apple.com/other','{}',array['trade'])",[owner,other]);
    const quoteTime=new Date().toISOString();const ready={symbol:'AAPL',id:'signal',status:'ready',expiresAt:new Date(Date.now()+14000).toISOString(),reasons:['Trend']};
    const publish=(data,time=quoteTime)=>db.query('select publish_trade_signal($1,$2,true,$3)',[JSON.stringify(data),time,'licensed']);
    // A broken outbox insert rolls back the signal and cooldown as well.
    await db.exec("alter table notification_events add constraint fail_trade check(topic<>'trade')");
    await assert.rejects(publish(ready),/fail_trade/);
    assert.equal((await db.query('select * from trade_signals')).rows.length,0);
    await db.exec('alter table notification_events drop constraint fail_trade');
    await publish(ready);await publish(ready);
    const events=(await db.query('select * from notification_events')).rows;
    assert.equal(events.length,1);assert.equal(events[0].data.userId,owner);
    const allowed=(user)=>db.query('select trade_delivery_allowed($1,$2) as ok',[events[0].id,user]);
    assert.equal((await allowed(owner)).rows[0].ok,true);assert.equal((await allowed(other)).rows[0].ok,false);
    // A halt with the SAME last trade timestamp must revoke an active signal.
    await publish({...ready,status:'blocked'});
    assert.equal((await allowed(owner)).rows[0].ok,false);
    await publish(ready);await db.query('update trade_preferences set enabled=false where user_id=$1',[owner]);
    assert.equal((await allowed(owner)).rows[0].ok,false);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from trade_signals'),/permission denied/);
    await assert.rejects(publish(ready),/permission denied/);
  } finally {await db.close();}
});

test('SQL trade claims retry within short TTL while existing news backoff stays unchanged',async()=>{
  const db=await database();
  try {
    const owner='11111111-1111-4111-8111-111111111111';await db.query('insert into auth.users values($1)',[owner]);
    await db.query('insert into trade_preferences(user_id,enabled) values($1,true)',[owner]);
    const sub=(await db.query("insert into push_subscriptions(user_id,endpoint,subscription,topics) values($1,'https://web.push.apple.com/retry','{}',array['trade','catalyst']) returning id",[owner])).rows[0].id;
    await db.query('select publish_trade_signal($1,now(),true,$2)',[JSON.stringify({symbol:'AAPL',id:'s',status:'ready',expiresAt:new Date(Date.now()+14000).toISOString(),reasons:[]}), 'licensed']);
    const event=(await db.query("select id from notification_events where topic='trade'")).rows[0].id;
    const claim=async()=> (await db.query('select claim_push_delivery($1,$2) as ok',[event,sub])).rows[0].ok;
    assert.equal(await claim(),true);assert.equal(await claim(),false);
    await db.exec("update push_deliveries set status='pending',locked_at=now()-interval '1100 milliseconds'");assert.equal(await claim(),true);
    await db.exec("update push_deliveries set status='pending',locked_at=now()-interval '1100 milliseconds'");assert.equal(await claim(),false);
    await db.exec("update push_deliveries set status='pending',locked_at=now()-interval '2100 milliseconds'");assert.equal(await claim(),true);
    await db.exec("update notification_events set expires_at=now()-interval '1 second'");assert.equal(await claim(),false);
    await db.exec("insert into notification_events(id,topic,title,body,url,published_at,expires_at) values('news','catalyst','x','x','/news',now(),now()+interval '1 hour')");
    await db.query("select claim_push_delivery('news',$1)",[sub]);
    await db.exec("update push_deliveries set status='pending',locked_at=now()-interval '2 seconds' where event_id='news'");
    assert.equal((await db.query("select claim_push_delivery('news',$1) as ok",[sub])).rows[0].ok,false);
  } finally {await db.close();}
});

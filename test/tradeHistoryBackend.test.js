import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {readTradeHistory,syncTradeHistory,loadPendingTradeHistorySymbols,normalizeTradeHistoryFilters,isTradeHistoryNotInstalled} from '../server/tradeHistory.js';
import {createTradeHandler} from '../server/tradeApi.js';

const now=Date.parse('2026-11-14T15:00:00Z');
const iso=(value)=>new Date(value).toISOString();
function plan(overrides={}) {
  return {id:'journal-1',symbol:'AAPL',name:'Apple',market:'ABD',currency:'USD',mode:'research',strategyId:'intraday',
    strategyName:'Gün içi',direction:'long',createdAt:iso(now),trackingStartsAt:iso(now+60000),trackingEndsAt:iso(now+3600000),
    entryDeadlineAt:iso(now+1800000),entry:100,entryLow:100,entryHigh:100,stopLoss:98,
    targets:[{id:'near',label:'İlk hedef',targetPrice:103,status:'pending',hitAt:null,exitPrice:null,netReturnPct:null}],
    status:'pending',enteredAt:null,closedAt:null,lastBarAt:null,lastCheckedAt:iso(now),netReturnPct:null,events:[],
    costBps:20,costAssumed:true,source:'Yahoo',sessionKey:'2026-11-14',trackingPolicy:'forward-limit-v1',
    entryModel:'forward-limit',executionModel:'Gelecekteki kapanmış mumda limit giriş.',...overrides};
}
async function database() {
  const db=new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role; create table monitor_status(id text primary key,updated_at timestamptz default now(),data jsonb);');
  const sql=await readFile(new URL('../supabase/migrations/20261114_trade_history.sql',import.meta.url),'utf8');
  await db.exec(sql);await db.exec(sql);
  return db;
}
async function save(db,record,revision=null) {
  return (await db.query('select public.save_trade_history($1::jsonb,$2::integer) as result',[JSON.stringify(record),revision])).rows[0].result;
}
function adapter(db) {
  const calls=[];
  return {calls,async rpc(name,args) {
    calls.push({name,args});
    try {
      if (name==='save_trade_history') return {data:await save(db,args.p_record,args.p_expected_revision)};
      const values=['p_since','p_symbol','p_strategy','p_mode','p_status','p_page','p_page_size'].map((key)=>args[key]);
      return {data:(await db.query('select public.read_trade_history($1::timestamptz,$2::text,$3::text,$4::text,$5::text,$6::integer,$7::integer) as result',values)).rows[0].result};
    } catch(error) {return {error};}
  },from(table) {
    let columns='*',filters=[],values=[],ordering='',limit='',single=false;
    const query={select(value){columns=value;return this;},eq(key,value){values.push(value);filters.push(`${key}=$${values.length}`);return this;},
      in(key,value){values.push(value);filters.push(`${key}=any($${values.length}::text[])`);return this;},
      order(key,{ascending=true}={}){ordering=`order by ${key} ${ascending?'asc':'desc'}`;return this;},
      limit(value){limit=`limit ${Number(value)}`;return this;},maybeSingle(){single=true;return this;},
      then(resolve,reject){return db.query(`select ${columns} from ${table} ${filters.length?`where ${filters.join(' and ')}`:''} ${ordering} ${limit}`,values)
        .then(({rows})=>({data:single?rows[0]??null:rows})).catch((error)=>({error})).then(resolve,reject);}};
    return query;
  }};
}

test('history migration is idempotent, immutable and uses optimistic revisions',async()=>{
  const db=await database();
  try {
    const original=plan();
    assert.deepEqual(await save(db,original),{saved:true,revision:1});
    assert.deepEqual(await save(db,{...original,entry:101}),{saved:false,revision:1},'Repeating creation never replaces the saved plan');
    assert.deepEqual(await save(db,{...original,status:'active'},99),{saved:false,revision:1});
    await assert.rejects(save(db,{...original,entry:101},1),/değiştirilemez/);
    await assert.rejects(save(db,{...original,trackingEndsAt:iso(now+7200000)},1),/değiştirilemez/);
    await assert.rejects(save(db,{...original,targets:[{...original.targets[0],targetPrice:104}]},1),/değiştirilemez/);
    const active={...original,status:'active',enteredAt:iso(now+60000),lastBarAt:iso(now+60000),lastCheckedAt:iso(now+120000)};
    assert.deepEqual(await save(db,active,1),{saved:true,revision:2});
    assert.deepEqual(await save(db,{...active,lastCheckedAt:iso(now+1000)},2),{saved:false,revision:2},'Out-of-order checks do not move the journal backwards');
    const closed={...active,status:'target',closedAt:iso(now+180000),lastCheckedAt:iso(now+180000),
      targets:[{...active.targets[0],status:'target',netReturnPct:2.8}],netReturnPct:2.8};
    assert.deepEqual(await save(db,closed,2),{saved:true,revision:3});
    await assert.rejects(save(db,{...closed,status:'active'},3),/Tamamlanan/);
    const partial=plan({id:'partial',status:'active',enteredAt:iso(now+60000),targets:[
      {...original.targets[0],status:'target',netReturnPct:2.8},
      {...original.targets[0],id:'extended',targetPrice:107},
    ]});
    await save(db,partial);
    await assert.rejects(save(db,{...partial,enteredAt:null},1),/model girişi/);
    await assert.rejects(save(db,{...partial,targets:[{...partial.targets[0],status:'stop'},partial.targets[1]]},1),/hedef sonucu/);
    assert.equal((await db.query('select count(*)::int as n from trade_history')).rows[0].n,2);
  } finally {await db.close();}
});

test('history tables and aggregate/write RPCs are inaccessible to browser roles',async()=>{
  const db=await database();
  try {
    await save(db,plan());
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from trade_history'),/permission denied/);
    await assert.rejects(save(db,plan({id:'other'})),/permission denied/);
    await assert.rejects(db.query('select public.read_trade_history()'),/permission denied/);
    await db.exec('reset role');
    await db.exec('set role service_role');
    assert.equal((await db.query('select public.read_trade_history(null) as result')).rows[0].result.pagination.total,1);
  } finally {await db.close();}
});

test('history summary covers more than 1000 filtered rows and is independent of pagination',async()=>{
  const db=await database();
  try {
    const original=plan();
    await db.query(`insert into trade_history(id,symbol,mode,status,created_at,data)
      select 'bulk-'||i,'AAPL','research',case when i%2=1 then 'target' else 'stop' end,$2::timestamptz,
        $1::jsonb || jsonb_build_object('id','bulk-'||i,'status',case when i%2=1 then 'target' else 'stop' end,
          'targets',jsonb_build_array(jsonb_build_object('id','near','label','İlk hedef','targetPrice',103,
            'status',case when i%2=1 then 'target' else 'stop' end,'netReturnPct',case when i%2=1 then 2.8 else -2.2 end)))
      from generate_series(1,1205) i`,[JSON.stringify(original),iso(now)]);
    await save(db,plan({id:'live-1',mode:'live'}));
    const sb=adapter(db);
    const history=await readTradeHistory(sb,{now,period:'all',mode:'research',page:2,pageSize:20});
    assert.equal(history.items.length,20);assert.equal(history.pagination.total,1205);assert.equal(history.pagination.hasMore,true);
    assert.equal(history.summary.total,1205);assert.equal(history.summary.resolved,1205);
    assert.equal(history.summary.targetCount,603);assert.equal(history.summary.stopCount,602);
    assert.equal(history.summary.targetRate,50.04);assert.equal(history.summary.byTarget[0].resolved,1205);
    assert.equal(history.summary.averageNetReturnPct,0.3021);
    const filtered=await readTradeHistory(sb,{now,period:'all',symbol:'aapl',status:'target',strategy:'intraday'});
    assert.equal(filtered.summary.total,603);assert.equal(filtered.summary.targetRate,100);
    const pending=await readTradeHistory(sb,{now,period:'all',mode:'live'});
    assert.equal(pending.summary.resolved,0);assert.equal(pending.summary.targetRate,null);assert.equal(pending.summary.averageNetReturnPct,null);
    assert.deepEqual(await loadPendingTradeHistorySymbols(sb,{mode:'live'}),['AAPL']);
  } finally {await db.close();}
});

test('history persistence ages only matching source mode and never creates when disabled',async()=>{
  const db=await database();
  try {
    const original=plan();
    await save(db,original);await save(db,plan({id:'live-model',mode:'live'}));
    const sb=adapter(db);
    const result=await syncTradeHistory(sb,null,{symbol:'AAPL',quote:{realtime:false},bars:[]},{now:now+7200000,createPlans:false});
    assert.equal(result.available,true);assert.equal(result.createdCount,0);assert.equal(result.updatedCount,1);
    const rows=(await db.query('select id,status from trade_history order by id')).rows;
    assert.equal(rows.find((row)=>row.id==='live-model').status,'pending');
    assert.notEqual(rows.find((row)=>row.id==='journal-1').status,'pending');
    const writes=sb.calls.filter((call)=>call.name==='save_trade_history');
    assert.equal(writes.length,1);assert.equal(writes[0].args.p_expected_revision,1);
  } finally {await db.close();}
});

test('modeled time exits contribute to the return mean but never inflate target or stop rates',async()=>{
  const db=await database();
  try {
    const winner=plan({id:'winner',status:'target',targets:[{id:'near',label:'İlk hedef',targetPrice:103,status:'target',netReturnPct:2.8}]});
    const timed=plan({id:'timed',status:'expired',enteredAt:iso(now+60000),targets:[{id:'near',label:'İlk hedef',targetPrice:103,status:'expired',netReturnPct:-4}]});
    const unfilled=plan({id:'unfilled',status:'expired',targets:[{id:'near',label:'İlk hedef',targetPrice:103,status:'expired',netReturnPct:null}]});
    const other=plan({id:'other-strategy',strategyId:'choch-fib-pullback',status:'pending'});
    for (const record of [winner,timed,unfilled,other]) await save(db,record);
    const history=await readTradeHistory(adapter(db),{period:'all',now});
    assert.equal(history.summary.resolved,1);assert.equal(history.summary.targetRate,100);assert.equal(history.summary.stopRate,0);
    assert.equal(history.summary.settledCount,2);assert.equal(history.summary.averageNetReturnPct,-0.6);
    assert.equal(history.summary.byTarget.length,2,'Target ids from different strategies stay separate');
    const primary=history.summary.byTarget.find((group)=>group.strategyId==='intraday');
    assert.equal(primary.total,3);assert.equal(primary.settledCount,2);assert.equal(primary.averageNetReturnPct,-0.6);
  } finally {await db.close();}
});

test('only known absent migration errors produce installationRequired; outages stay errors',async()=>{
  const missing={message:'Could not find the function public.read_trade_history in the schema cache',code:'PGRST202'};
  assert.equal(isTradeHistoryNotInstalled(missing),true);
  assert.equal(isTradeHistoryNotInstalled({message:'Connection to trade_history timed out',code:'57014'}),false);
  const empty=await readTradeHistory({rpc:async()=>({error:missing})},{period:'all'});
  assert.equal(empty.installationRequired,true);assert.equal(empty.summary.total,0);assert.equal(empty.summary.targetRate,null);
  await assert.rejects(readTradeHistory({rpc:async()=>({error:{message:'database unavailable',code:'08006'}})},{period:'all'}),/unavailable/);
});

const response=()=>({statusCode:200,setHeader(){},status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}});
test('history API requires authentication, accepts bounded filters and avoids state refreshes',async()=>{
  let calls=0;
  const sb={auth:{getUser:async(token)=>({data:{user:token==='valid'?{id:'owner'}:null}})}};
  const handler=createTradeHandler({getDb:()=>sb,now:()=>now,readHistory:async(db,filters)=>{
    calls++;assert.equal(db,sb);assert.equal(filters.mode,'research');assert.equal(filters.period,'7');
    assert.equal(filters.now,now);return {items:[],summary:{total:0},pagination:{total:0}};
  },refreshResearch:async()=>assert.fail('History must not trigger state refresh')});
  const req={method:'GET',query:{action:'history',mode:'research',period:'7'},headers:{}};
  const missing=response();await handler(req,missing);assert.equal(missing.statusCode,401);assert.equal(calls,0);
  const invalid=response();await handler({...req,headers:{authorization:'Bearer invalid'}},invalid);assert.equal(invalid.statusCode,401);assert.equal(calls,0);
  const valid=response();await handler({...req,headers:{authorization:'Bearer valid'}},valid);assert.equal(valid.statusCode,200);assert.equal(calls,1);
  const rejects=createTradeHandler({getDb:()=>sb,now:()=>now});
  const bad=response();await rejects({...req,query:{action:'history',page:'-2'},headers:{authorization:'Bearer valid'}},bad);
  assert.equal(bad.statusCode,400);assert.match(bad.body.error,/filtresi/);
  assert.throws(()=>normalizeTradeHistoryFilters({symbol:['AAPL','MSFT']},now),/filtresi/);
  assert.throws(()=>normalizeTradeHistoryFilters({status:'success'},now),/filtresi/);
  assert.throws(()=>normalizeTradeHistoryFilters({period:'-1'},now),/filtresi/);
  assert.throws(()=>normalizeTradeHistoryFilters({pageSize:1000},now),/filtresi/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { requestHedgeJob, reconcileHedgeJob, maybeRefreshHedge } from '../server/hedgeJobs.js';

const env={HEDGE_RADAR_USER_ID:'owner',HEDGE_GITHUB_TOKEN:'secret',HEDGE_GITHUB_REPOSITORY:'owner/repo'};
function database(reservation={revision:2,status:'queued',dispatch:true,retryAfterSeconds:0}) {
  const calls=[],patches=[];
  let state={owner_user_id:'owner',refresh_version:2,refresh_status:'queued',refresh_run_id:123,
    refresh_run_url:'https://github.com/owner/repo/actions/runs/123',refresh_deadline_at:'2026-10-28T15:00:00Z'};
  return {calls,patches,get state(){return state;},async rpc(name,args){
    calls.push({name,args});
    if(name==='reserve_hedge_radar_refresh')return {data:reservation};
    if(name==='fail_hedge_radar_run')state={...state,refresh_status:'failed'};
    if(name==='start_hedge_radar_run')state={...state,refresh_status:'running'};
    return {data:true};
  },from(){return {select(){return this;},eq(){return this;},in(){return this;},update(value){patches.push(value);return this;},
    async maybeSingle(){return {data:state};},then(resolve,reject){return Promise.resolve({data:null}).then(resolve,reject);}};}};
}

test('GitHub dispatch cevabındaki gerçek iş kimliği kaydedilir ve revizyon girdisi bağlanır', async () => {
  const db=database();
  await requestHedgeJob(db,'owner',{env,fetcher:async(url,options)=>{
    assert.ok(url.endsWith('/hedge_radar.yml/dispatches'));
    assert.deepEqual(JSON.parse(options.body),{ref:'main',inputs:{refresh_version:'2'}});
    return Response.json({workflow_run_id:123,html_url:'https://evil.test/ignored'});
  }});
  assert.deepEqual(db.patches,[{refresh_run_id:123,refresh_run_url:'https://github.com/owner/repo/actions/runs/123'}]);
});

test('etkin veya bekleme süreli istek yeni GitHub işi üretmez', async () => {
  const db=database({revision:2,status:'running',dispatch:false,retryAfterSeconds:0});
  const result=await requestHedgeJob(db,'owner',{env,fetcher:async()=>assert.fail('Yeni iş başlatılmamalı')});
  assert.equal(result.status,'running'); assert.equal(db.calls.length,1);
});

test('GitHub işi kabul ettikten sonraki kayıt hatası çalışan analizi başarısız yapmaz', async () => {
  const db=database();
  db.from=()=>{throw new Error('database unavailable');};
  const result=await requestHedgeJob(db,'owner',{env,fetcher:async()=>Response.json({workflow_run_id:123})});
  assert.equal(result.runId,123);
  assert.equal(db.calls.some((call)=>call.name==='fail_hedge_radar_run'),false);
});

test('başlatılamayan iş revizyona bağlı başarısız olur, gizli hata metni döndürülmez', async () => {
  const db=database();
  await assert.rejects(requestHedgeJob(db,'owner',{env,fetcher:async()=>{throw new Error('secret token');}}),
    error=>!error.message.includes('secret')&&error.message.includes('yeniden deneyin'));
  assert.equal(db.calls.at(-1).name,'fail_hedge_radar_run');
  assert.equal(db.calls.at(-1).args.p_revision,2);
});

test('işin gerçek çalışma, hata, iptal ve sonuç kaydetmeme durumları panel durumuna yansır', async () => {
  for(const [status,conclusion,expected] of [['in_progress',null,'running'],['completed','failure','failed'],
    ['completed','cancelled','failed'],['completed','success','failed']]) {
    const db=database();
    const state=await reconcileHedgeJob(db,db.state,{env,now:Date.parse('2026-10-28T14:00:00Z'),
      fetcher:async()=>Response.json({status,conclusion})});
    assert.equal(state.refresh_status,expected);
  }
});

test('durum sorgulama arızası başarılı veya devam eden analizi başarısız saymaz', async () => {
  const db=database();
  const state=await reconcileHedgeJob(db,db.state,{env,now:Date.parse('2026-10-28T14:00:00Z'),
    fetcher:async()=>{throw new Error('network');}});
  assert.equal(state.refresh_status,'queued'); assert.equal(db.calls.length,0);
});

test('otomatik analiz New York seans saatleri ve yaz/kış saatini gözetir', async () => {
  for(const time of ['2026-10-28T14:00:00Z','2026-11-02T15:00:00Z']) {
    const db=database({dispatch:false,status:'completed'});
    await maybeRefreshHedge(db,{env,now:new Date(time)});
    assert.equal(db.calls[0].args.p_source,'scheduled');
  }
  for(const time of ['2026-10-28T12:00:00Z','2026-10-31T14:00:00Z','2026-11-02T14:00:00Z']) {
    const db=database(); await maybeRefreshHedge(db,{env,now:new Date(time)});
    assert.equal(db.calls.length,0);
  }
});

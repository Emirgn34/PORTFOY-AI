import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('SQL: etkin iş tekrar kullanılır, hata kısa bekler, başarı beş dakika bekler ve eski iş yeni sonucu ezemez', async () => {
  const db = new PGlite();
  const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    for (const path of ['automation-schema.sql','migrations/20261024_hedge_radar.sql','migrations/20261028_hedge_refresh_tracking.sql']) {
      await db.exec(await readFile(new URL(`../supabase/${path}`,import.meta.url),'utf8'));
    }
    await db.query('insert into auth.users values($1),($2)',[owner,other]);
    const reserve = async (source='manual',user=owner) => (await db.query('select reserve_hedge_radar_refresh($1,$2) as result',[user,source])).rows[0].result;
    const start = async (revision,run=101) => (await db.query('select start_hedge_radar_run($1,$2,$3,$4) as result',
      [owner,revision,run,`https://github.com/owner/repo/actions/runs/${run}`])).rows[0].result;
    const fail = async (revision,run=101) => (await db.query('select fail_hedge_radar_run($1,$2,$3,$4) as result',
      [owner,revision,run,'Veri alınamadı.'])).rows[0].result;
    let request=await reserve(); assert.equal(request.revision,1); assert.equal(request.dispatch,true);
    request=await reserve(); assert.equal(request.revision,1); assert.equal(request.dispatch,false);
    await assert.rejects(reserve('manual',other),/başka hesaba/);
    assert.equal((await start(1)).started,true);
    request=await reserve(); assert.equal(request.status,'running'); assert.equal(request.dispatch,false);
    await db.exec(await readFile(new URL('../supabase/migrations/20261028_hedge_refresh_tracking.sql',import.meta.url),'utf8'));
    assert.equal((await reserve()).status,'running'); // migration rerun leaves active work intact
    assert.equal(await fail(1),true);
    request=await reserve(); assert.equal(request.dispatch,false); assert.ok(request.retryAfterSeconds>0 && request.retryAfterSeconds<=30);
    await db.exec("update hedge_radar_state set refresh_retry_at=now()-interval '1 second'");
    assert.equal((await reserve('scheduled')).dispatch,false); // automation backs off five minutes
    request=await reserve(); assert.equal(request.revision,2); assert.equal(request.dispatch,true);
    assert.equal((await start(1)).started,false);
    assert.equal(await fail(1),false);
    assert.equal((await start(2,202)).started,true);
    const payload={owner_user_id:owner,updated_at:new Date().toISOString(),market_regime:'SAFE',qqq_price:100,
      portfolio_beta:1.2,stock_radar:[],hedge_recipe:{},diagnostics:{workflow_run_id:'202',notifications_allowed:false}};
    const publish = async (data,revision=2) => (await db.query('select publish_hedge_radar_state($1,$2) as result',[data,revision])).rows[0].result;
    assert.equal(await publish({...payload,diagnostics:{workflow_run_id:'101'}}),false);
    assert.equal(await publish(payload,1),false);
    assert.equal(await publish(payload),true);
    assert.equal(await fail(2,202),false); // notification/check failure cannot fail a published analysis
    const saved=(await db.query('select * from hedge_radar_state')).rows[0];
    assert.equal(saved.refresh_status,'completed'); assert.ok(saved.refresh_completed_at);
    request=await reserve(); assert.ok(request.retryAfterSeconds>290 && !request.dispatch);
    assert.equal((await reserve('scheduled')).dispatch,false);
    await db.exec("update hedge_radar_state set refresh_retry_at=now()-interval '1 second'");
    request=await reserve(); assert.equal(request.revision,3);
    await db.exec("update hedge_radar_state set refresh_deadline_at=now()-interval '1 second'");
    request=await reserve(); assert.equal(request.revision,4); assert.equal(request.dispatch,true);
    assert.equal((await start(3,303)).started,false);
    assert.equal(await publish({...payload,updated_at:new Date(Date.now()+1000).toISOString()},2),false);
    await db.exec('set role authenticated');
    await assert.rejects(reserve(),/permission denied/);
    await assert.rejects(db.query('select publish_hedge_radar_snapshot($1,$2)',[payload,4]),/permission denied/);
  } finally { await db.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('SQL: tek satır, sahiplik, bekleme süresi, eski yazımı reddetme ve tekil kalkan bildirimi',async()=>{
  const db=new PGlite();
  const owner='11111111-1111-4111-8111-111111111111';
  const other='22222222-2222-4222-8222-222222222222';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    await db.exec(await readFile(new URL('../supabase/automation-schema.sql',import.meta.url),'utf8'));
    const sql=await readFile(new URL('../supabase/migrations/20261024_hedge_radar.sql',import.meta.url),'utf8');
    await db.exec(sql);await db.exec(sql);
    await db.query('insert into auth.users values($1),($2)',[owner,other]);
    const revision=(await db.query('select request_hedge_radar_refresh($1) as version',[owner])).rows[0].version;
    assert.equal(revision,1);
    await assert.rejects(db.query('select request_hedge_radar_refresh($1)',[owner]),/5 dakika/);
    await assert.rejects(db.query('select request_hedge_radar_refresh($1)',[other]),/başka hesaba/);
    const payload={owner_user_id:owner,updated_at:new Date().toISOString(),market_regime:'HEDGE_TRIGGER',
      qqq_price:100,portfolio_beta:1.55,recommended_action:'Koruma senaryosu',stock_radar:[],hedge_recipe:{},
      diagnostics:{notifications_allowed:true,closing_window:true,session_date:'2026-10-23'}};
    const publish=(value)=>db.query('select publish_hedge_radar_state($1,$2) as published',[value,revision]);
    assert.equal((await publish(payload)).rows[0].published,true);
    assert.equal((await publish(payload)).rows[0].published,false);
    await assert.rejects(publish({...payload,updated_at:new Date(Date.now()+1000).toISOString(),owner_user_id:other}),/sahibi değiştirilemez/);
    const queued=await db.query('select queue_hedge_radar_notification() as id');
    assert.ok(queued.rows[0].id.startsWith('hedge-'));
    assert.equal((await db.query('select queue_hedge_radar_notification() as id')).rows[0].id,null);
    await publish({...payload,updated_at:new Date(Date.now()+1000).toISOString()});
    assert.equal((await db.query('select queue_hedge_radar_notification() as id')).rows[0].id,null);
    assert.equal((await db.query('select * from hedge_radar_state')).rows.length,1);
    const events=await db.query("select * from notification_events where topic='hedge-radar'");
    assert.equal(events.rows.length,1);assert.equal(events.rows[0].data.userId,owner);
    await db.exec(`set request.jwt.claim.sub='${other}';set role authenticated;`);
    assert.equal((await db.query('select * from hedge_radar_state')).rows.length,0);
    await assert.rejects(db.query('select queue_hedge_radar_notification()'),/permission denied/);
    await db.exec('reset role');
    await db.exec(`set request.jwt.claim.sub='${owner}';set role authenticated;`);
    assert.equal((await db.query('select * from hedge_radar_state')).rows.length,1);
    await assert.rejects(db.query('update hedge_radar_state set qqq_price=1'),/permission denied/);
  } finally {await db.close();}
});

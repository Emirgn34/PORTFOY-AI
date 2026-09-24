import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('SQL: kuyruk, tek seferlik yayın, kullanıcı izolasyonu ve push claim atomik çalışır',async () => {
  const db=new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key);');
    const schema=await readFile(new URL('../supabase/automation-schema.sql',import.meta.url),'utf8');
    await db.exec(schema); await db.exec(schema); // migration yeniden çalıştırılabilir
    const user='11111111-1111-4111-8111-111111111111';
    await db.query('insert into auth.users values($1)',[user]);
    const requested=await db.query('select request_value_portfolios($1,$2) as id',[user,{}]);
    const id=requested.rows[0].id;
    assert.equal((await db.query('select request_value_portfolios($1,$2) as id',[user,{}])).rows[0].id,id);
    const claimed=await db.query('select * from claim_value_portfolio_job()');
    assert.equal(claimed.rows[0].id,id); assert.equal(claimed.rows[0].status,'running');
    assert.equal((await db.query('select * from claim_value_portfolio_job()')).rows.length,0);
    await assert.rejects(db.query('select finish_value_portfolio_job($1,$2)',[id,JSON.stringify([{}])]),/Dört/);
    assert.equal((await db.query('select * from value_portfolio_versions')).rows.length,0);
    await db.query('select finish_value_portfolio_job($1,$2)',[id,JSON.stringify([{}, {}, {}, {}])]);
    assert.equal((await db.query('select * from value_portfolio_versions')).rows.length,1);
    assert.equal((await db.query('select status from portfolio_jobs where id=$1',[id])).rows[0].status,'completed');
    await assert.rejects(db.query('select request_value_portfolios($1,$2)',[user,{}]),/5 dakika/);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from value_portfolio_versions'),/permission denied/);
    await assert.rejects(db.query('select request_value_portfolios($1,$2)',[user,{}]),/permission denied/);
    await db.exec('reset role');
    const sub=(await db.query("insert into push_subscriptions(user_id,endpoint,subscription) values($1,'https://web.push.apple.com/test','{}') returning id",[user])).rows[0].id;
    await db.query("insert into notification_events(id,topic,title,body,url,published_at,expires_at) values('event','catalyst','x','x','/news',now(),now()+interval '1 hour')");
    assert.equal((await db.query("select claim_push_delivery('event',$1) as claimed",[sub])).rows[0].claimed,true);
    assert.equal((await db.query("select claim_push_delivery('event',$1) as claimed",[sub])).rows[0].claimed,false);
    await db.query("update push_deliveries set status='sent'");
    assert.equal((await db.query("select claim_push_delivery('event',$1) as claimed",[sub])).rows[0].claimed,false);
  } finally { await db.close(); }
});

test('SQL: kaynak sepeti ve değişim bildirimi birlikte kaydedilir; tekrar veya başarısızlık bildirim kaybettirmez',async () => {
  const db=new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key);');
    await db.exec(await readFile(new URL('../supabase/automation-schema.sql',import.meta.url),'utf8'));
    const payload=(selectionFingerprint) => JSON.stringify({selectionFingerprint,portfolios:[{},{},{},{}]});
    await db.query('select publish_source_portfolios($1,$2)',['first',payload('a')]);
    assert.equal((await db.query('select * from notification_events')).rows.length,0);
    await db.query('select publish_source_portfolios($1,$2)',['unchanged',payload('a')]);
    assert.equal((await db.query('select * from notification_events')).rows.length,0);
    // Bildirim yazımı bozulursa sepet de yayımlanmamalı; tekrar denemede olay kaybolmaz.
    await db.exec("alter table notification_events add constraint simulate_failure check(topic<>'source-portfolios')");
    await assert.rejects(db.query('select publish_source_portfolios($1,$2)',['changed',payload('b')]),/simulate_failure/);
    assert.equal((await db.query('select * from source_portfolio_runs')).rows.length,2);
    await db.exec('alter table notification_events drop constraint simulate_failure');
    await db.query('select publish_source_portfolios($1,$2)',['changed',payload('b')]);
    await db.query('select publish_source_portfolios($1,$2)',['changed',payload('b')]);
    assert.equal((await db.query('select * from source_portfolio_runs')).rows.length,3);
    assert.equal((await db.query('select * from notification_events')).rows.length,1);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select publish_source_portfolios($1,$2)',['forged',payload('c')]),/permission denied/);
  } finally { await db.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('SQL: haber taraması tek sahipli çalışır, minimum aralığı korur ve eski çağrı yeni kilidi bırakamaz', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key);');
    await db.exec(await readFile(new URL('../supabase/automation-schema.sql', import.meta.url), 'utf8'));
    const migration = await readFile(new URL('../supabase/migrations/20261028_news_scan.sql', import.meta.url), 'utf8');
    await db.exec(migration); await db.exec(migration);
    const claim = async () => (await db.query('select claim_news_scan() as token')).rows[0].token;
    const first = await claim(); assert.ok(first);
    assert.equal(await claim(), null);
    await db.exec(migration); assert.equal(await claim(), null); // rerun doesn't reset lease
    await db.query('select release_news_scan($1)', [first]);
    assert.equal(await claim(), null); // still within 45 seconds
    await db.exec("update monitor_status set updated_at=now()-interval '46 seconds' where id='news-scan-lock'");
    const second = await claim(); assert.ok(second && second !== first);
    await db.query('select release_news_scan($1)', [first]);
    assert.equal(await claim(), null); // stale owner cannot unlock second run
    await db.exec("update monitor_status set updated_at=now()-interval '91 seconds',data=jsonb_set(data,'{lockedUntil}',to_jsonb(now()-interval '1 second')) where id='news-scan-lock'");
    assert.ok(await claim()); // recover a crashed invocation
    await db.exec('set role authenticated');
    await assert.rejects(claim(), /permission denied/);
    await assert.rejects(db.query('select release_news_scan($1)', [first]), /permission denied/);
  } finally { await db.close(); }
});

test('SQL: cron kurulumu secret gerektirir; aynı işi günceller ve kontrolden önce etkinleştirmez', async () => {
  const db = new PGlite();
  try {
    // pg_cron/pg_net/Vault aren't available in PGlite. Stub their documented SQL
    // interfaces to verify the actual setup file, job commands and parameters.
    await db.exec(`create schema cron; create schema net; create schema vault;
      create table vault.decrypted_secrets(name text primary key,decrypted_secret text);
      create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text,active boolean default true);
      create table cron.job_run_details(jobid bigint,end_time timestamptz);
      create table net.requests(id bigserial primary key,url text,headers jsonb,body jsonb,timeout_ms integer);
      create function cron.schedule(p_name text,p_schedule text,p_command text) returns bigint language sql as $$
        insert into cron.job(jobname,schedule,command) values(p_name,p_schedule,p_command)
        on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid;
      $$;
      create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$
        update cron.job set active=$2 where jobid=$1;
      $$;
      create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$
        insert into net.requests(url,headers,body,timeout_ms) values($1,$2,$3,$4) returning id;
      $$;`);
    const setup = (await readFile(new URL('../supabase/news-cron-setup.sql', import.meta.url), 'utf8'))
      .replace(/^create extension .*;$/gm, '');
    await assert.rejects(db.exec(setup), /news_scan_url/);
    const url = 'https://example.vercel.app/api/account?feature=news-scan';
    await db.query('insert into vault.decrypted_secrets values($1,$2)', ['news_scan_url', url]);
    await assert.rejects(db.exec(setup), /news_cron_secret/);
    await db.query('insert into vault.decrypted_secrets values($1,$2)', ['news_cron_secret', 'a'.repeat(40)]);
    await db.exec(setup); await db.exec(setup);
    const jobs = (await db.query('select * from cron.job order by jobname')).rows;
    assert.equal(jobs.length, 2);
    const news = jobs.find((job) => job.jobname === 'portfoyai-free-news');
    assert.equal(news.schedule, '* * * * *'); assert.equal(news.active, false);
    assert.ok(!news.command.includes('a'.repeat(40)));
    const check = (await db.query('select * from net.requests order by id desc limit 1')).rows[0];
    assert.equal(check.url, url); assert.equal(check.headers['x-cron-secret'], 'a'.repeat(40));
    assert.deepEqual(check.body, { checkOnly: true }); assert.equal(check.timeout_ms, 60000);
    await db.exec(await readFile(new URL('../supabase/news-cron-enable.sql', import.meta.url), 'utf8'));
    assert.equal((await db.query("select active from cron.job where jobname='portfoyai-free-news'")).rows[0].active, true);
  } finally { await db.close(); }
});

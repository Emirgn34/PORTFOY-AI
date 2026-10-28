-- Apply AFTER deployment and after creating two secrets in Supabase Vault:
-- news_scan_url: https://YOUR-PRODUCTION-DOMAIN/api/account?feature=news-scan
-- news_cron_secret: the exact NEWS_CRON_SECRET configured in Vercel.
-- Keep the actual secret in Vault; never commit it or paste it into chat.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare target_url text; cron_secret text;
begin
  select decrypted_secret into target_url from vault.decrypted_secrets where name='news_scan_url';
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name='news_cron_secret';
  if target_url is null or target_url !~ '^https://[^/]+/api/account\?feature=news-scan$' then
    raise exception 'Vault news_scan_url: üretim adresini /api/account?feature=news-scan ile kaydedin.';
  end if;
  if cron_secret is null or length(cron_secret)<32 then
    raise exception 'Vault news_cron_secret: Vercel NEWS_CRON_SECRET değerini kaydedin (en az 32 karakter).';
  end if;
end $$;

-- First request checks configuration without collecting or sending notifications.
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='news_scan_url'),
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
    (select decrypted_secret from vault.decrypted_secrets where name='news_cron_secret')),
  body := '{"checkOnly":true}'::jsonb, timeout_milliseconds := 60000
) as configuration_check_request_id;

-- Naming the job makes repeated setup update the same job, rather than add one.
select cron.schedule('portfoyai-free-news','* * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='news_scan_url'),
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='news_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  );
$job$);
-- Leave collection inactive until the configuration response is verified.
select cron.alter_job((select jobid from cron.job where jobname='portfoyai-free-news'),active:=false);

-- Bound only this job's operational history, retaining the last seven days.
select cron.schedule('portfoyai-news-history-cleanup','23 3 * * *',$job$
  delete from cron.job_run_details
  where jobid in (select jobid from cron.job where jobname in
    ('portfoyai-free-news','portfoyai-news-history-cleanup'))
    and end_time < now()-interval '7 days';
$job$);

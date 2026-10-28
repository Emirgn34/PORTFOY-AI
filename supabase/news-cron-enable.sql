-- Run ONLY after the check request from news-cron-setup.sql returns HTTP 200
-- and {"ok":true,"checks":{"scanLockReady":true,"pushConfigured":true}}.
-- Check with: select id,status_code,content,error_msg from net._http_response
--            where id = YOUR_CONFIGURATION_CHECK_REQUEST_ID;
-- The request queue's decrypted headers must not be copied into chat or logs.
select cron.alter_job((select jobid from cron.job where jobname='portfoyai-free-news'),active:=true);

select jobname,schedule,active from cron.job
where jobname in ('portfoyai-free-news','portfoyai-news-history-cleanup');

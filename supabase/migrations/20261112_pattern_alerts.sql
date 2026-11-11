-- Tekrarlayan düşüş istatistiği bildirimleri için 'pattern' konusu.
-- Üretici: server/patternStats.js + server/tradeWorker.js (refreshTradeContext).
-- Olay kimliği sembol + düşüş kovası + kovaya giriş gününden türetilir; aynı
-- düşüş bölümü için ikinci bildirim üretilmez (ignoreDuplicates upsert).
-- Bu migration kurulmadan worker desen bildirimi ekleyemez ve yalnızca uyarı
-- loglar; diğer her şey çalışmaya devam eder.
begin;
alter table public.notification_events drop constraint if exists notification_events_topic_check;
alter table public.notification_events add constraint notification_events_topic_check
  check(topic in ('catalyst','source-portfolios','hedge-radar','trade','pattern'));
commit;

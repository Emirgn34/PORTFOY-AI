# Ücretsiz hızlı haber toplayıcısı — 28 Ekim 2026

## Ne değişir?

Mevcut dört PR Newswire / GlobeNewswire RSS akışı, Vercel üzerinde tek tarama
girişinden paralel okunur. Supabase Cron bu girişi dakikada bir çağırır; sonuçlar
mevcut Supabase `notification_events` tablosunda toplanır. Ayrı sunucu hesabı veya
ücretli haber aboneliği gerekmez. Platformların ücretsiz kullanım kotaları geçerlidir.

Başlıklar mevcut dört kategoriyle filtrelenir: tahmin yükseltme, beklenti üstü
sonuç, düzenleyici onay ve sözleşme. Olumsuz/söylenti/beklenti başlıkları, geçersiz
tarih/URL ve ABD hisse kodu olmayan kayıtlar bildirim üretmez. Bu kurallar haberin
doğrulandığı, anlaşmanın öneminin parasal olarak ölçüldüğü veya tüm haberlerin
kapsandığı anlamına gelmez. Sınıflandırma ve bildirim ömrü değiştirilmedi.

Aynı sağlayıcı ve haber kimliğinin farklı RSS listelerinde tekrarı tek olaydır.
Farklı sağlayıcıların aynı olayı farklı haber kimlikleriyle yayımlamasına yönelik
anlamsal tekilleştirme bu aşamada yapılmaz; farklı açıklamalar yanlışlıkla birleştirilmez.

## 1. SQL migration

Supabase SQL Editor'da `supabase/migrations/20261028_news_scan.sql` dosyasını
çalıştırın. Mevcut otomasyon tabloları önceden kurulmuş olmalı. Migration yalnızca
ortak tarama kilidini kurar, zamanlayıcıyı başlatmaz. Tekrar çalıştırılabilir.

Kilit Cron, GitHub fallback ve isteğe bağlı daemon arasında paylaşılır. Aynı anda
tek RSS taraması yapılır; iki başlangıç arasında en az 45 saniye olur. Çöken çağrının
kilidi 90 saniyede dolar. Eski bir çağrı sonraki çağrının kilidini bırakamaz.

## 2. Kod yayını

Yeni kodu mevcut GitHub `main` dalına ve Vercel projesine yayımlayın. Yeni bir
Vercel fonksiyonu eklenmez; mevcut `api/account.js` üzerinden
`POST /api/account?feature=news-scan` kullanılır. `/api/news/scan` aynı girişe yönlenir.
Bu fonksiyonun üst süresi 60 saniye olarak ayarlanır.

Vercel'de mevcut `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, VAPID ayarları ve
en az 32 karakterlik ayrı `NEWS_CRON_SECRET` bulunmalı. Kalkan için kullanılan
`CRON_SECRET` değiştirilmez. Vercel Secret değerleri kaydedildikten sonra panelden
okunamadığından, var olan gizli değeri kopyalamak gerekli değildir. Ayrı haber
anahtarı tanımlanmamış eski kurulumlarda `CRON_SECRET` kullanılmaya devam eder.

Yeni haber anahtarını kendi bilgisayarınızda üretip doğrudan panoya almak için:

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" | Set-Clipboard
```

Bu işlem anahtarı terminale yazdırmadan panoya kopyalar. Aynı değeri Vercel'de
`NEWS_CRON_SECRET` (Production, Secret) ve Vault'ta `news_cron_secret` olarak
kaydedin. İki kayıt arasında yeniden anahtar üretmeyin. Yeni ortam değişkeni için
uygulamanın bu kodla yeniden yayımlanması gerekir.

Tarama yalnızca doğru `x-cron-secret` başlığıyla POST üzerinden çağrılır. Kullanıcı
JWT'si bu işlemi başlatamaz. İstek gövdesi kaynak, filtre veya tarama aralığı belirleyemez.

## 3. Supabase Vault ayarları

Supabase Vault'ta aşağıdaki iki kayıt oluşturulur. Secret değerini sohbete,
GitHub dosyasına veya ekran görüntüsüne koymayın.

| Ad | Değer |
| --- | --- |
| `news_scan_url` | `https://portfoy-ai-ukyt.vercel.app/api/account?feature=news-scan` — üretim alan adı farklıysa onu kullanın |
| `news_cron_secret` | Bu kurulumda üretilip Vercel'e eklenen `NEWS_CRON_SECRET` ile birebir aynı değer |

Vault ayarları Supabase projesinin Integrations / Vault bölümündedir. Arayüz yolu
değişmişse resmi Vault belgesindeki yönetim yönergelerini kullanın:
https://supabase.com/docs/guides/database/vault

## 4. Zamanlayıcıyı hazırla ve bağlantıyı doğrula

Kod yayımlandıktan ve Vault ayarları girildikten sonra
`supabase/news-cron-setup.sql` çalıştırılır. `pg_cron` ve `pg_net` etkinleştirilir;
aynı isimli işi tekrar oluşturmak çoğaltmak yerine günceller.

Bu dosya `portfoyai-free-news` işini **pasif** bırakır ve bir `checkOnly` isteği
gönderir. Bu istek haber taramaz veya bildirim göndermez. Sorgu çıktısındaki
`configuration_check_request_id` değerini not edin. Birkaç saniye sonra şu sorguda
örnek `123` yerine o değeri kullanın:

```sql
select id,status_code,content,error_msg
from net._http_response
where id=123;
```

Beklenen sonuç: `status_code=200`, yanıtta `ok=true`,
`checks.scanLockReady=true` ve `checks.pushConfigured=true`.

401 secret uyumsuzluğu; 404 yanlış URL veya kodun henüz yayında olmaması;
503 SQL/sunucu/VAPID kurulumu sorunu anlamına gelebilir. Vercel koruması tarafından
dönen 401 de ayrıca proje erişim ayarlarından incelenmelidir. Sonuç henüz boşsa
isteğin tamamlanmasını bekleyip sorguyu tekrar çalıştırın. İstek kuyruğunun ham
header alanını paylaşmayın; bu alan çözülmüş secret içerir.

## 5. Dakikalık taramayı etkinleştir

Kontrol başarılı olduktan sonra `supabase/news-cron-enable.sql` çalıştırılır.
`portfoyai-free-news` satırında `schedule=* * * * *` ve `active=true` görünmeli.

Bir sonraki dakikadan sonra:

```sql
select updated_at,data->>'runner' as runner,
  data->>'connected' as connected,data->>'intervalSeconds' as interval_seconds,
  data->>'lastSuccessfulCheckAt' as last_successful_check,
  data->>'durationMs' as duration_ms,data->'errors' as errors
from public.monitor_status where id='news';
```

En son Cron turu çalıştıysa `runner=supabase-cron`, `interval_seconds=60` ve en az
bir kaynaktan yanıt alındıysa `connected=true` görünür. GitHub fallback turu en
son çalıştıysa geçici olarak `runner=github` görülebilir. Haber gelmemesi, tarama
başarısızlığı değildir: filtreyi geçen yeni açıklama yayımlanmamış olabilir.

`cron.job_run_details` içindeki başarı yalnızca HTTP isteğinin kuyruğa alınmasını
gösterebilir. Gerçek HTTP durumunu `net._http_response`, kaynak başarısını
`monitor_status` üzerinden doğrulayın. Yalnızca bu iki haber Cron işinin yedi günden
eski çalışma geçmişi günlük temizlenir; haber ve kullanıcı kayıtları silinmez.

Sitede Haberler → Hızlı Şirket Haberleri alanında kontrol aralığı, tarama süresi ve
yanıt veren kaynak sayısı görünür. Gerçek yeni ve filtreyi geçen bir açıklama ile
telefon teslimi ayrıca kontrol edilir.

## İşleme ve gecikme

Dört HTTP isteği birlikte başlar; her biri en fazla 8 saniye bekler. Uygun haberler
toplu kaydedilir. İlk kayıt biter bitmez bildirim gönderimi başlar; yavaş kaynak
ve tam başlık çevirisi beklenmez. İlk bildirimde Türkçe olay özeti kullanılır.
Sonrasında tur başına en fazla altı başlık çevrilir; ilk algılama, sona erme ve
teslim kayıtları değişmez. Sonradan çeviri aynı haberi yeniden bildirmez.

Başarılı kayıttan sonra ETag/Last-Modified bilgileri tutulur. Sağlayıcı 304 dönerse
tekrar indirme ve işleme atlanır. Kaynak veya veritabanı hatası cache bilgisini
ilerletmez. Kaynak başarısızlığı son başarılı kontrol zamanını yenilemez.

Her dakika planlama, haberin bir dakikada kesin ulaşması demek değildir. Kaynak
yayımlama sıklığı, kaynak listelerinin sınırlı uzunluğu, ağ, platform ve telefon
gecikmeleri kalır. 15 dakikalık bildirim ömrü korunur.

Haberin kaynakta yayımlanması, algılanması ve push sağlayıcısının kabulü ayrıdır:

```sql
select e.id,e.published_at,e.detected_at,d.delivered_at,
  extract(epoch from e.detected_at-e.published_at) as source_to_detection_seconds,
  extract(epoch from d.delivered_at-e.detected_at) as detection_to_provider_seconds
from public.notification_events e
join public.push_deliveries d on d.event_id=e.id
where e.topic='catalyst' and d.status='sent'
order by d.delivered_at desc limit 20;
```

Bu sorgu yetkili SQL Editor içindir. `delivered_at` telefonda görünme teyidi değildir.

## Durdurma ve fallback

Yeni dakikalık işi durdurmak için:

```sql
select cron.alter_job((select jobid from cron.job where jobname='portfoyai-free-news'),active:=false);
```

Mevcut GitHub haber işi beş dakikada bir planlanmaya devam eder. Dakikalık iş
etkinken ortak kilit gereksiz eşzamanlı taramayı önler; GitHub arşiv taraması ve
çeviriler devam eder. İsteğe bağlı `npm run news:free` aynı kilidi kullanır.

## Kaynaklar

- Supabase Cron: https://supabase.com/docs/guides/cron
- Dakikalık HTTP çağrıları ve Vault: https://supabase.com/docs/guides/functions/schedule-functions
- Cron kurulumu ve geçmiş temizliği: https://supabase.com/docs/guides/cron/quickstart
- Vercel ücretsiz plan dahilindeki kullanım: https://vercel.com/docs/functions/usage-and-pricing
- 304 davranışı: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/304

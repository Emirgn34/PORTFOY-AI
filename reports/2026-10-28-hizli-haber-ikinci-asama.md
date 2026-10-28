# Ücretsiz hızlı haberleri hızlandırma — 28 Ekim 2026

## Sonuç ve kapsam

Kullanıcının ikinci maddesi ve çok kaynağı tek merkezde filtreleme önerisi için
mevcut Supabase/Vercel altyapısına merkezi, dakikada bir çağrılabilen RSS toplayıcısı
hazırlandı. Bu rapor yerel uygulamayı ve testleri kapsar. Dakikalık Cron henüz canlıda
etkinleştirilmedi; gerçek yeni haberin telefona teslim süresi ölçülmüş sayılmaz.

Kaynaklar mevcut dört PR Newswire/GlobeNewswire akışıdır; ek ücretli veri sağlayıcısı,
sunucu hesabı veya paket bağımlılığı eklenmedi. Ücretsiz platform kotaları geçerlidir.

## Doğrulanan beklemeler ve değişiklikler

Önceki kaynak döngüsü dört isteği sırayla yapıyor, her yeni eşleşmede veritabanı
okuması ve 1,5 saniyeye kadar çeviri bekliyordu. Bildirim gönderimi bütün kaynak
döngüsünden sonra başlıyordu. Yeni sürümde dört istek birlikte başlar; her kaynağın
8 saniyelik süresi vardır. Bir kaynağın arızası diğerlerini durdurmaz.

Her kaynak için uygun kayıtlar bir okuma/yazma grubuyla veritabanına aktarılır.
Kaydedilmiş haberin sağlayıcı/kimliği tekrar kullanılmaz ve ilk algılama zamanı
değiştirilmez. Yeni haber kaydolunca diğer kaynaklar bitmeden gönderim tetiklenir.
Tek tur içindeki gönderim istekleri seri bir zincirde birleştirilir; push teslim
claim mekanizması cihaz başına tekrar gönderimi önlemeye devam eder.

İlk kayıtta Türkçe olay özeti kullanılır. Tam başlık çevirileri gönderimden sonra
tur başına en fazla altı kayıt için yapılır; GitHub fallback daha büyük eski çeviri
kuyruğunu işlemeye devam eder. Hazır Türkçe başlık varsa korunur. ETag/Last-Modified
yalnızca başarılı kayıttan sonra ilerletilir; 304 yanıtında yeniden işleme yapılmaz.

Son kontrolün ne kadar sürdüğü, yanıt veren kaynak sayısı ve son başarılı kontrol
zamanı kaydedilir. Yeni haber olmaması bağlantı arızası sayılmaz. Tek kaynak arızası
ve tüm kaynakların bağlantı sorunu ekranda ayrı gösterilir.

## Merkezi çalışma

Supabase Cron, mevcut `/api/account?feature=news-scan` girişine dakikada bir POST
gönderir. `/api/news/scan` aynı girişe yönlendirilir. Giriş, en az 32 karakterlik
ayrı `NEWS_CRON_SECRET` ile doğrulanır. Bu değişken tanımlanmamış eski kurulumlarda
`CRON_SECRET` kullanılabilir. Kullanıcı JWT'si veya istek gövdesiyle kaynak
adresi/filtre/çalışma aralığı belirlenemez. Yeni Vercel fonksiyonu eklenmez.

Cron, GitHub fallback ve isteğe bağlı daemon için ortak DB kilidi bulunur. Başlangıçlar
arasında en az 45 saniye olur; kilit 90 saniyede dolar. Eski çağrı yeni çağrının
kilidini bırakamaz. Migration mevcut haberleri, abonelikleri ve teslimleri değiştirmez.

Kurulum dosyası zamanlayıcıyı pasif bırakır ve bildirim üretmeyen `checkOnly`
denetimi gönderir. HTTP sonucu doğrulandıktan sonra ayrı dosyayla etkinleştirilir.
İstek sırrı Supabase Vault'tan okunur. İş kaydında literal secret tutulmaz. Cron
çalışma geçmişi temizliği yalnızca bu iki yeni haber işinin yedi günden eski
operasyon kayıtlarını kapsar. Geri dönüşte dakikalık iş pasife alınabilir.

## Kontroller

| Kontrol | Sonuç |
| --- | --- |
| Sunucu/veritabanı testleri | 101/101 başarılı |
| Arayüz testleri | 69/69 başarılı |
| Hedge algoritması | 9/9 başarılı; mevcut `.tmp/hedge-venv` kullanıldı |
| TypeScript | `tsconfig.hedge.json` başarılı |
| Üretim derlemesi | Başarılı |
| `git diff --check` | Boşluk hatası yok |

Kurulum takip düzeltmesi: Vercel Secret değerinin panelden okunamaması nedeniyle
haber için ayrı anahtar desteği eklendi; kalkanın anahtarı değiştirilmez. Bağımsız
haber anahtarı tanımlanınca yalnız o kabul edilir; boş/kısa bir değer yapılandırma
hatası olarak kapalı kalır. İki yeni kimlik testiyle sunucu/veritabanı testleri
yeniden çalıştırıldı: **103/103 başarılı**. Bu küçük API düzeltmesi ayrıca kod
yayını gerektirir. Gizli değerler kodda veya raporda tutulmaz.

Yeni testler; hızlı kaynağın yavaş kaynaktan önce gönderilmesi, cache ve kayıt
hatasının tekrar denenmesi, önemsiz/tekrarlı haber filtresi, çeviriyi beklemeyen
kayıt, ortak kilit ve çökme kurtarma, API kimlik denetimi, Cron kurulumunun
tekrarlanabilirliği ve pasif başlaması, kaynak durumunun doğru gösterilmesini kapsar.

PGlite testinde gerçek tarama kilidi migration'ı çalıştırıldı. pg_cron, pg_net ve
Vault PGlite'da bulunmadığından Cron kurulum dosyası, belgelenmiş SQL arayüzlerinin
test karşılıklarıyla doğrulandı; canlı uzantı ve HTTP denetimi kurulumda yapılmalı.
Arayüz testleri jsdom kullanır. Gerçek telefon testi yapılmadı.

Mevcut dört halka açık RSS adresi ayrıca salt okunur olarak kontrol edildi. Tek
örneklemede dördü HTTP 200 ve geçerli XML döndürdü; yanıtlar yaklaşık 81–486 ms
aralığındaydı. Her akış 20 öğe döndürdü. Bu ölçüm üretim gecikmesi veya tüm haberlerin
kapsanması için kanıt değildir. Canlı veritabanına test haberi yazılmadı, test push
gönderilmedi. Genel Python kurulumunda bir bağımlılık eksikti; var olan proje sanal
ortamı ile hedge kontrolleri geçti. Yeni bağımlılık kurulmadı.

## Yayın sırası ve sınırlar

1. `supabase/migrations/20261028_news_scan.sql`
2. GitHub/Vercel kod yayını
3. Vault `news_scan_url` ve `news_cron_secret`
4. `supabase/news-cron-setup.sql` ve HTTP kurulum kontrolü
5. `supabase/news-cron-enable.sql` ve gerçek kaynak/telefon gözlemi

Ayrıntılı yönergeler ve gecikme ölçüm sorguları `NEWS_SCAN_SETUP.md` içindedir.
Dakikalık planlama sabit teslim süresi garantisi değildir. Kaynakların yayın
gecikmesi ve sınırlı RSS listeleri devam eder. 15 dakikalık haber bildirim ömrü ve
mevcut dört başlık sınıflandırması korunur. Farklı sağlayıcı kimlikleri altında
yayımlanan benzer olaylar anlamsal olarak birleştirilmez.

## Resmi referanslar

- https://supabase.com/docs/guides/cron
- https://supabase.com/docs/guides/functions/schedule-functions
- https://supabase.com/docs/guides/cron/quickstart
- https://supabase.com/docs/guides/database/vault
- https://vercel.com/docs/functions/usage-and-pricing
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/304

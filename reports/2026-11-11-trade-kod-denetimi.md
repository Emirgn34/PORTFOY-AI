# Trade kod denetimi — 11 Kasım 2026

Denetim başlangıcında yerel `main` ile GitHub'daki yayın aynıydı: `ee168610ec0cfc01e5f1958d6f3dc8428c87948f`. GitHub CI ve Vercel yayın durumu başarılıydı. Çalışma ağacında Trade kodunun yarım veya kaydedilmemiş bir sürümü bulunmadı. Elektrik kesintisinin aşağıdaki hatalara sebep olduğunu gösteren kanıt yoktur.

## Görülen uyarının nedeni

Canlı `trade_signals` kaydı yokken API mevcut araştırma adaylarını `quote:{}` ve boş barlarla motora veriyordu. Motor doğru biçimde canlı sinyali engelliyor, ancak ilk engel olarak para birimi doğrulamasını gösteriyordu. Bu bir USD/TRY kur arızası veya veritabanının ısınma süresi değildir. Kullanıcının belirttiği mevcut kurulumda lisanslı canlı fiyat kaynağı henüz bağlı değildir; beklemek bunu değiştirmez.

Araştırma kartları artık açıkça `research-only` olarak işaretlenir, canlı veri kaynağının eksik olduğu açıklanır. Para birimi doğrulaması gevşetilmemiştir; yanlış birimdeki fiyat giriş/stop/hedef olarak gösterilmez.

## Bulunan ve düzeltilen sorunlar

| Alan | Sorun | Düzeltme / doğrulama |
|---|---|---|
| SQL yayın sırası | Aynı fiyat zamanı için `ready → blocked/halt → gecikmiş eski ready` hissedeki blokajı kaldırabiliyordu. | Ek migration alım zamanını ve durum sırasını kontrol eder. Aynı fiyat zamanında daha gevşek duruma dönüş yeni piyasa damgasını bekler. PGlite regresyonu bunu yeniden üretip engellendiğini doğrular. |
| Kaynak önceliği | Webhook kurulumu Yahoo araştırma turuna girip lisanslı sinyali ezebiliyordu. | Webhook modunda fiyat fallback'i/yeni araştırma sinyali yayını kapalı; SQL de taze lisanslı kaydı gecikmeli araştırmadan korur. |
| Webhook bağlamı | Sadece webhook kullanılan yeni kurulumda şirket ve makro bağlamı hiç yenilenmeyebilirdi. | Ayrı ve sınırlı bağlam yenilemesi; kendi hatası canlı feed durumunu değiştirmez, kapanış sonrası DB yazmaz. |
| Bağlantı arızası | Son fiyat henüz 15 saniyelik süreyi aşmadığında bilinen bağlantı hatası hazır kartı veya sıradaki bildirimi açık bırakabiliyordu. | API ve arayüz hazır durumu kaldırır; SQL bildirim kapısı sağlıklı feed durumunu da arar. |
| Makro olay | Başlangıçtan 30 dakikadan uzakta, ancak işlemin bekleme süresi içindeki makro olay karttan kayboluyordu. | Yaklaşan olay korunur ve çakışan hedef senaryosu elenir. Daha kısa uygun hedef kalabilir. |
| Araştırma kapsamı | Worker hep ilk 20 sembolü işliyor; ilk kayıtlar gelince diğer aday kartları kaybolabiliyordu. | 50 sembole kadar dönen 20/20/10 partiler; API eksik adayları araştırma kartlarıyla tamamlar, sembolleri tekilleştirir. |
| Heartbeat | 60 saniyelik araştırma aralığı 30 saniyelik bağlantı sınırıyla çelişiyordu. | Araştırmada 90 saniye, lisanslı akışta 30 saniye. Fiyat ve bar tazelik sınırları değişmedi. |
| Tercih yarışı | Eski bir GET yanıtı başarılı bildirim tercihini geri almış gibi gösterebiliyordu. | Tercih revizyonu eski yanıtın yeni tercihi ezmesini önler. |
| Oturum takılması | İptal ve 12 saniye sınırı `getSession` beklemesini kapsamıyordu. | Sınır oturum, HTTP isteği ve yanıt gövdesini kapsar; geç oturum sonucu yeni istek başlatmaz. |
| Cihaz aboneliği | Trade konusu kayıtlı olmadan seçili görünebiliyor, kayıt sırasında seçim değiştirilebiliyordu. | Kayıtlı konular aynen gösterilir; kaydedilmemiş değişiklik açıklanır ve kayıt sırasında seçim kilitlenir. |
| Sayısal seviyeler | Çok küçük fiyatlarda yuvarlama giriş ile stopu aynı seviyeye indirebilirdi; taşan hesaplar ve null eski kayıtlar yeterince korunmuyordu. | Geçersiz seviyeler gösterilmez ve sinyal engellenir; sonlu sayı/null regresyonları eklendi. |
| Oturum hizmeti | Sunucudaki kimlik doğrulama bağlantısı hata fırlattığında kontrollü API yanıtı dönmeyebiliyordu. | Açıklamalı 503 yanıtı. |

## Kapsam ve sınırlar

Motor, API, Vercel/local yönlendirmeleri, istemci/polling, hedef ve adet hesabı, worker modları, bildirim göndericisi, service worker ve SQL/RLS yolları incelendi. Mevcut haber abonelikleri ve diğer portföy işlevleri için regresyon testleri de çalıştırıldı.

Son doğrulama: `npm test` ile **161 sunucu/birim testi + 108 arayüz testi = 269 test** geçti. `npm run build` başarılı, `git diff --check` temiz. SQL testleri gerçek PostgreSQL uyumlu PGlite üzerinde yeni migration'ın iki kez uygulanmasını, atomik kayıt/geri alma, yetki izolasyonu ve ters sıradaki güncellemeleri kapsar. İncelenen ilk yayın CI'si de başarılıydı; yeni düzeltmelerin yerel test sonucu ilk yayınla karıştırılmamalıdır.

Yerel testlerin geçmesi kârlılık, canlı veri lisansı, üretim DB'sine yeni migration uygulanması veya gerçek telefonda teslim teyidi değildir. Lisanslı feed, sürekli worker ve gerçek telefon testi hâlâ ayrı kurulum/doğrulama gerektirir. Sonuçlar, gerçek piyasada başarı yüzdesi veya milisaniye gecikme ölçümü olarak sunulmaz.

## Mevcut kuruluma uygulanacaklar

1. `supabase/migrations/20261111_trade_publication_order.sql` ek migration'ı uygulanır.
2. Bu denetimin güncel kodu aynı GitHub/Vercel projesine gönderilir.
3. Eski sürekli göndericiler yeniden başlatılır; lisanslı veri hâlâ bağlı değilse hazır sinyal/bildirim beklenmez.

Bu rapor hazırlanırken yeni ek migration üretim veritabanında çalıştırılmadı; üretim sırlarına veya kullanıcı hesaplarına erişilmedi.

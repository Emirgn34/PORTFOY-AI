# 28 Ekim 2026: bildirimler ve geliştirme sırası

İlk aşama yerel kaynak kodunda bildirim gönderimini düzeltir. Canlı sistemin
logları, veritabanı durumu ve gerçek telefon teslimi bu çalışma ile doğrulanmış
sayılmaz. Mevcut ücretsiz haber kaynaklarıyla devam edilmesi kullanıcı tercihidir.

## Kodda doğrulanan nedenler

1. Gönderici yalnızca en eski 100 geçerli olayı okuyordu. Bu sayfayı daha önce
   işlenmiş olaylar doldurunca yeni olaylar süresi dolana kadar okunmayabiliyordu.
2. Her cihaz sırayla işleniyordu. Tek yavaş endpoint sonraki cihazları bekletiyordu.
3. Abonelikler offset ile sayfalanıyordu. 404/410 nedeniyle abonelik silinince
   sonraki sayfaya geçişte cihaz atlanabiliyordu.
4. Cihazda mevcut abonelik, sunucunun güncel VAPID anahtarıyla karşılaştırılmadan
   yeniden kullanılıyordu. Süresi dolmuş abonelik ve kapalı izin ayrımı eksikti.
5. Geçici gönderim hatalarının türü kaydedilmiyordu; dört deneme kısa sürede
   tükenebiliyordu. Yeniden denemelerin zamanlaması yalnızca işçi turuna bağlıydı.

Haberin yayımlanmasından 15 dakika sonra bildirim penceresi kapanır. GitHub haber
işi beş dakikada bir planlanır; ayrıca kaynak ve kurulum gecikmesi vardır. Ücretsiz
RSS işçisi kodda 60 saniyelik aralıkla bulunur; canlıda sürekli çalıştığı yerelden
kanıtlanamaz. Bu durumlar gönderim düzelse bile haber gecikmesini açıklayabilir.

## Uygulanan ilk aşama

Tüm geçerli olaylar kimlik ile sayfalanır ve algılama zamanı en yeni olanlar önce
işlenir. Aboneliklerde de kimlik sayfalaması kullanılır. Aynı anda en fazla beş
cihaza gönderilir; mevcut atomik teslim sahiplenmesi ve hesap/konu sınırları korunur.

Geçici hatalarda sekiz deneme, 15/30/60/120 saniyelik artan asgari aralıklar ve
iki dakikalık yarım kalan iş kurtarma süresi uygulanır. Yeniden denemeler mevcut
işçi çalıştığında yapılır. Gönderim özeti ve anonim hata sayıları kaydedilir.
Sağlayıcı kabulünden sonraki veritabanı yazma hatası hemen `pending` yapılıp
aynı turda tekrar gönderilmez; lease dolana kadar `sending` kalır.

Cihaz ekranı izin/abonelik sorununu belirtir. Kullanıcı etkinleştirme düğmesine
bastığında eski anahtarlı veya süresi dolmuş abonelik yenilenir. Sunucuda kaydı
eksik ama geçerli cihaz aboneliği yeniden kaydedilir. Otomatik izin istenmez.

Kurulum: önce `supabase/migrations/20261028_push_delivery_retries.sql`, sonra
uygulama ve haber işçilerinin yeni kodu. Ayrıntılar `DEPLOYMENT.md` içindedir.

## Doğrulama

- `npm.cmd run test:unit`: 85/85 başarılı.
- `npm.cmd run test:ui`: 66/66 başarılı.
- `npm.cmd run build`: başarılı.
- `git diff --check`: boşluk hatası yok.

Yeni senaryolar; 100 eski teslimin yeni olayı gizlememesi, 101. cihazın önceki
sayfadaki silinmeden etkilenmemesi, en fazla beş eşzamanlı gönderim, geçici/kalıcı
hatalar, hesap/konu izolasyonu, SQL yeniden deneme beklemeleri, süresi dolmuş veya
anahtarı değişmiş abonelik, kapalı izin ve kayıt hatasında geri almayı kapsar.
Arayüz testleri jsdom kullanır; gerçek telefon doğrulaması yapılmadı. Vite test
ve derleme işlemleri üst dizin okuma kısıtı nedeniyle izinli çalıştırmayla geçti.

## Sıradaki konuşma ve uygulama başlıkları

1. **Ücretsiz hızlı haber:** RSS kaynaklarını sınırlı eşzamanlı çekmek, çeviriyi
   bildirim öncesi bekleme zincirinden çıkarmak, yeni olay kaydolur kaydolmaz
   gönderimi tetiklemek; mevcut 60 saniyelik işçinin sürekli çalışmasını doğrulamak.
   Kaynağın yayın zamanı, ilk algılama ve sağlayıcı kabul zamanını ayrı ölçmek.
   GitHub zamanlaması için gecikme olasılığı resmi belgede de belirtilir:
   https://docs.github.com/en/actions/how-tos/troubleshoot-workflows
2. **Portföy Kalkanı:** GitHub işinin kabul edilmesi ile analizin tamamlanmasını
   ayırmak; çalışan/başarısız/zaman aşımı durumunu işin gerçek sonucu ile bağlamak.
   Mevcut SQL her istekte beş dakika sınırını kontrol eder; arayüzdeki kuyruk ise
   15 dakika sonra zaman aşmış görünür. Başarısız işten sonra yeniden denemeyi ve
   devam eden aynı işe dönmeyi tek bir kurala bağlamak gerekir.
3. **Portföy düzeni:** basılı tutup taşıma, kaydırma ile çakışmayan sürükleme kolu,
   sıralamanın hesaba kaydı ve klavye ile yukarı/aşağı taşıma.
4. **Paylaşım görseli:** dağılım alanını sağa kaydırınca koyu arka plan ve turkuaz
   vurgulu paylaşım kartı; hisse kodu ve yüzde dışında tutar, fiyat, miktar ve
   hesap kimliği bulunmaması. İndirme/paylaşma için görsel üretimini yalnızca
   dağılım yüzdelerinden beslemek.

Bu başlıklar henüz uygulanmış sayılmaz. Haber kaynağının gecikmesini gönderim
düzeltmesinin tek başına ortadan kaldırdığı veya tüm gelişmeleri yakaladığı
iddia edilmez.

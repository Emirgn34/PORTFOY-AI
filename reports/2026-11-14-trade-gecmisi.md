# Trade geçmişi ve model sonuç günlüğü

14 Kasım 2026. Bu rapor yerel uygulama ve testleri kapsar; üretime kod yayını,
uzak veritabanına migration veya gerçek piyasa performansı doğrulanmadı.

## Eklenen davranış

- Trade altında erişilebilir Güncel Fırsatlar ve Geçmiş Tradeler sekmeleri.
- Kaydedilen ilk giriş, hedef, stop, maliyet varsayımı, kaynak, strateji ve zamanlar.
- Giriş bekliyor, takipte, hedef, stop, süre doldu, sıra belirsiz, değerlendirilemedi durumları.
- Tarih/hisse/strateji/veri türü/sonuç filtreleri, sunucu sayfalaması, sabit plan detayları ve zaman çizelgesi.
- Tüm filtreli veriyi kapsayan SQL özeti. Sayfa uzunluğu veya Supabase'in varsayılan satır sınırı başarı oranını değiştirmez.
- Modele gerçekten giriş oluşup fiyatla doğrulanmış süre sonu çıkışı yapıldığında, getirisi ortalamaya dahil edilir. Hedef/stop oranları yalnız hedef veya stop sırası doğrulanan ilk hedefleri kapsar.

## Gözlem kuralları

Ana gün içi plan, hisse/kaynak/veri türü/seans başına ilk geçerli plan olarak
arşivlenir. Aynı gün sonraki fiyat güncellemeleri yeni ana işlem üretmez. Video
planları teyitli pivotların kimliği ve yöne göre ayrılır; geçersiz eski yapı yeniden
arşivlenmez. Araştırma planı en fazla 30 dakika yaşındaki fiyat ve mumlarla
oluşturulabilir; takip fiyatın geçmiş zamanından değil, planın arşivlendiği andan
sonraki ilk tam dakikadan başlar. Ağ isteği dakika sınırını aşarsa arşiv saati
monotonik geçen süreyle ilerletilir; plan önceden başlamış muma geri yazılmaz.

Araştırma/video girişi sabit referansa, bölgeli planda orta noktaya, gelecekte
kapanmış tam mumda temasla modellenir. 30 dakikalık giriş penceresinde temas yoksa
işlem açılmamıştır. Canlı ana planda güncel referans alış fiyatından varsayımsal
giriş kullanılır. Bu bir emir veya gerçek gerçekleşme teyidi değildir. Canlı sinyalin
yaklaşık 15 saniyelik geçerliliği pozisyonun takip bitişi olarak kullanılmaz.

Hedefler bağımsız senaryolardır. İlk hedef görüldükten sonra diğer hedefler stop
olabilir; ilk hedefin sonucu korunur. Hedef ve stop aynı mumdaysa sıra tahmin
edilmez. Giriş ile çıkış aynı mumdaysa, giriş açıkça mum açılışında değilse sonuç
belirsizdir. Canlı varsayımsal girişin ilk kısmi mumunda temasın girişten önce mi
sonra mı olduğu anlaşılamıyorsa yine belirsizdir. Stop ötesine olumsuz açılışta
model çıkışı açılış fiyatını kullanır; olumlu hedef boşluğunda kazanç hedefte sınırlıdır.

Takip kaynak seans sonunda, sınırlar bilinmiyorsa altı saatlik pencerenin son tam
dakikasında biter. Tam ve kesintisiz fiyat kapsamı varsa son kapanışla model çıkışı
hesaplanır. Eksik, bozuk veya yinelenmiş mumlar ve kaynak/para birimi uyuşmazlığı
uydurma sonuç üretemez. Gecikmeli mumlara 30 dakika gözlem payı tanınır; süre sonunda
eksik kapsam değerlendirilemedi olarak kapanır. Short getirisinin yönü ve maliyet
hesabı ayrıca test edilir. Gerçek borçlanma/taşıma ücretleri model kapsamında değildir.

## Kalıcılık ve bulut

`trade_history` ve yazma/okuma fonksiyonları yalnız sunucu service-role rolüne
açıktır. Tarayıcı geçmişi JWT doğrulayan mevcut account API üzerinden alır.
Plan kimliği ve fiyatları veritabanında korunur; revizyon kontrolü eşzamanlı
güncellemelerin ilerlemeyi geri almasını engeller. Tamamlanmış hedefler açık kalan
diğer hedefler değerlendirilirken de değiştirilemez.

Her veri işleme turu günlüğü ilerletir. Arşiv kurulumunun eksik olması veya geçmiş
veritabanı hatası, kaydedilmiş canlı sinyal/bildirim işlemini geri almaz. Geçmiş API
bilinen eksik migration ile gerçek hizmet hatasını ayırır.

Mevcut dakikalık haber cron'u araştırma takibini sayfa kapalıyken de başlatır.
Geçmiş işi, yavaş çeviri/günlük desen sağlayıcılarının arkasında beklemez. Her tur
en fazla beş araştırma sembolünü kalıcı son deneme zamanlarıyla döndürür; kaynak
çağrıları 4,5 saniyelik zaman aşımına sahiptir. Bu sınır tüm veritabanı işlerinin
toplam süre garantisi değildir. Açık canlı modeller bulut yolunda yalnız boş fiyat
kanıtıyla yaşlandırılır; Yahoo mumları canlı modelin hedef/stopunu sonuçlandıramaz.
Lisanslı kaynak tanımlıysa araştırma yolu canlı sinyal ve bağlantı durumunu değiştirmez.

## Doğrulama ve yayına alma

`npm test` tüm sunucu/birim ve arayüz testleriyle başarılı; 24 arayüz dosyasında
129 test geçti. `npm run build` başarılı; `git diff --check` temiz.
Yeni testler gerçek PostgreSQL uyumlu PGlite üzerinde migration'ın tekrar
uygulanmasını, yetkileri, sabit planları, revizyon yarışlarını, 1.205 satırlık
veri için özet/sayfalama bağımsızlığını, ileri izleme ve belirsizlik kurallarını kapsar.
Bulut testsiz bir varsayım olarak bırakılmadı: tarayıcı isteği olmadan kayıt,
kalıcı sırayla dönüş, veri hatası, canlı/araştırma ayrımı ve dakika sınırını aşan
ağ isteği ayrıca test edildi. Tarayıcı erişim host'u bu oturumda kullanılamadığı
için gerçek tarayıcıda görsel önizleme doğrulanmadı.

Yeni SQL: `supabase/migrations/20261114_trade_history.sql`.
Önce SQL uygulanmalı, ardından kod mevcut projeye yayımlanmalıdır. Sayfa kapalı
takip için mevcut haber cron'unun etkin olması gerekir. Bu oturumda üretim sırları
bulunmadığından uzak kurulum ve üretim verileri değiştirilmedi. Arşiv ileriye
dönük birikir; eski, üzerine yazılmış planların doğrulanmış geçmişi oluşturulmaz.

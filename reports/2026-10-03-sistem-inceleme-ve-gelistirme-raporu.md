# PortföyAI — Sistem inceleme ve geliştirme raporu

**Tarih:** 3 Ekim 2026  
**İncelenen sürüm:** `be0f59d`  
**Amaç:** Yatırım kararlarının kalitesini, portföy getirisinin doğru ölçülmesini ve uygulamanın tutarlılığını geliştirmek. Abonelik geliri bu raporun odağı değildir.

## 1. Değerlendirmem

PortföyAI; kişisel portföy takibi, haber ve olay analizi, fırsat taraması, hazır portföyler, değer seçimi ve kurumsal yatırımcı araştırmasını bir araya getiren kapsamlı bir temele sahip. Kanıt kapısı, işlem maliyeti varsayımları, aylık portföy sürümleri, veri kapsamı kontrolleri ve ileri test kayıtları üzerinde düşünülmüş.

**Bence en yüksek faydayı önce hesap doğruluğu, aynı veride aynı karar, veri eksikliğinde temkinli davranış ve gerçekleşen sonuçlardan öğrenme sağlayacak.** Yeni bir puan veya yeni bir haber kaynağı eklemeden önce bunları tamamlamak gerekir.

İncelemede özellikle şunları doğruladım:

1. **Aynı kanıt, iki iş akışında farklı fırsat kararı üretebiliyor.** AI değerlendirmesinden sonra 54 olan kanıt puanı, yeni bilgi gelmeden haber kontrolünde 90'a çıkabiliyor.
2. **Kişisel portföyün TL kâr/zararı gerçek yatırım deneyimini tam ölçmüyor.** Alış kuru ve işlem geçmişi yok; bugünkü pozisyonlardan geçmiş dönem kârı hesaplanıyor.
3. **Veri eksikliği bazen düşük risk gibi görünebiliyor.** Hiç fiyat, bilanço veya haber alınamayan sentetik örnekte “Düşük” risk üretildi.
4. **Giriş planında bozulmuş bir kurulum uygun giriş olarak etiketlenebiliyor.** 97 bozulma seviyesinin altındaki 90 fiyatına “bölgenin içinde” denildi.
5. **Yüksek güven ve beklenen getiri henüz ölçülmüş başarı olasılığı değil.** Tek tahmin sürücüsüyle 0,91 güven üretilebiliyor; bu, %91 gerçekleşme olasılığı anlamına gelmiyor.

Bu bulgular uygulamanın kârsız olduğunu kanıtlamaz. Mevcut kodun ve eldeki doğrulamanın, güvenilir bir “piyasayı yeniyor” sonucuna yetmediğini gösterir. İyileştirmelerin getiriye etkisi ayrıca ölçülmelidir.

## 2. İncelemenin kapsamı ve doğrulama

İnceleme; React ekranları ve veri bağlantıları, fiyat/kur hesapları, aday üretimi, skor ve kanıt motorları, model/değer/kaynak portföyleri, ileri test, Supabase şemaları, otomasyon işleri ve mevcut testleri kapsar.

| Kontrol | Sonuç |
|---|---|
| Sunucu, hesaplama ve veritabanı testleri | **67/67 geçti** |
| Arayüz testleri | **50/50 geçti**, 12 test dosyası |
| Üretim derlemesi | **Başarılı** |
| Ek yerel denetim örnekleri | **10 sentetik senaryo doğrulandı** |
| Canlı veritabanı, gerçek hesap getirisi, gerçekleşen işlemler | Bu incelemede doğrulanmadı |
| Tarayıcıda görsel ve uçtan uca inceleme | Kullanılabilir tarayıcı oturumu bulunmadığı için yapılamadı |

İlk arayüz testi ve derleme denemesi çalışma ortamının dizin erişim kısıtına takıldı; izinli yeniden çalıştırmada ikisi de geçti. Grafik testlerinde jsdom boyut ölçüm uyarıları çıktı; bunu canlı ekran hatası olarak yorumlamıyorum.

Uygulama kaynak kodu, canlı veri ve dağıtım değiştirilmedi. Bu raporla birlikte [tekrarlanabilir denetim betiği](2026-10-03-inceleme-kanitlari.mjs) ve [çıktıları](2026-10-03-inceleme-kanitlari.json) hazırlandı. Betik dış ağ erişimini kapatır ve sahte veri sağlayıcıları kullanır.

**Kanıt ayrımı:** “Doğrulandı” ifadesi sentetik örnek veya doğrudan kod davranışını; “risk” ifadesi belirli koşullarda oluşabilecek sonucu; “öneri” ise henüz denenmemiş geliştirmeyi anlatır. Canlıda veri kaybı yaşandığı veya önerilen stratejilerin daha çok kazandıracağı iddia edilmiyor.

## 3. Korunması gereken güçlü taraflar

- **Fırsat ve kanıt puanı ayrılmış.** Salt teknik yükselişin yeterli sayılmaması, bir olay ve ek teyit aranması faydalı.
- **Uygun aday yoksa nakitte kalma yaklaşımı var.** Portföyü doldurmak için kalite eşiğini gevşetmemek doğru.
- **Aylık seçimde geçmiş analizler ve değişim sınırları kullanılıyor.** Her taramada tüm sepeti değiştirmekten kaynaklanan işlem yükünü azaltabilecek bir temel.
- **Model portföy sürümleri ve günlük değer kayıtları mevcut.** Bölünme düzeltmesi ve eksik kapsamda resmî değer kaydı yayımlamama kontrolleri özellikle değerli.
- **İleri test için zaman damgalı sinyaller tutuluyor.** 20/252 işlem seansı, günlük tekrarların birleştirilmesi ve tahmini maliyet indirimi uygulanmış.
- **AI kapsamı ve maliyeti sınırlandırılmış.** Kısa açıklama, dar sınıflandırma, önbellek ve kota yaklaşımı korunmalı.
- **Kullanıcı verisi için RLS ve otomasyon için atomik işlemler var.** Kuyruk sahiplenme, bildirim tekilleştirme ve yayın işlemleri test edilmiş.
- **Bazı yöntem sınırları kullanıcıya zaten anlatılıyor.** Kaynak portföylerinin gerçek fon getirisi olmadığı ve hazır portföy performansına temettülerin dahil olmadığı açıklanmış.

## 4. Öncelik sırası

P0: Doğru karar veya veri bütünlüğü için önce ele alınmalı. P1: Ölçüm ve yatırım sürecinin ana geliştirmesi. P2: Temel düzeldikten sonra geliştirilmesi uygun.

| Öncelik | Konu | Beklenen yarar | Efor öngörüsü |
|---|---|---|---|
| P0 | AI sonrası puanın olay nöbetinde korunması | Yeni kanıt olmadan oluşan fırsat değişimini önler | Küçük |
| P0 | Yanıltıcı kâr/zarar etiketleri ve eksik veri davranışı | Yanlış kazanç/risk algısını önler | Küçük–orta |
| P0 | Bulut okuma hatasının boş portföy sayılmaması | Portföy verisinin yanlışlıkla üzerine yazılması riskini azaltır | Orta |
| P0 | Bozulmuş giriş planının engellenmesi | Çelişkili alım bölgesi mesajını kaldırır | Küçük |
| P1 | İşlem defteri, tarihsel kur ve gerçek getiri hesabı | Kazancı ve kaybın kaynağını doğru ölçer | Büyük |
| P1 | Ortak analiz/veri kalitesi sözleşmesi | Aynı hisse için ekranlar arası tutarlılık sağlar | Orta–büyük |
| P1 | Tahmin güveninin ve eşiklerin kalibrasyonu | Zayıf avantajı güçlü sinyal gibi sunma riskini azaltır | Büyük; veri birikimi gerekir |
| P1 | Strateji bazında maliyet sonrası ileri test | Hangi kuralın işe yaradığını gösterir | Büyük |
| P1 | Pozisyon büyüklüğü ve birleşik portföy riski | Tek işlem ve ortak tema kaynaklı kaybı sınırlar | Orta–büyük |
| P1 | Verinin gerçek yaşı ve otomatik fiyat yenilemesi | Eski veya eksik fiyatla karar verilmesini azaltır | Orta |
| P1 | Haberlerin olay düzeyinde doğrulanması | Tek haberin çoklu teyit gibi sayılmasını azaltır | Orta |
| P2 | Değer ve kaynak portföylerinin karşılaştırma yöntemi | Ucuzluk ve geçmiş kazanan seçimini daha anlamlı kılar | Orta–büyük |
| P2 | Karar günlüğü ve tek karar ekranı | Analizi uygulanabilir ve takip edilebilir hale getirir | Orta |

Eforlar mevcut mimariye göre göreli tahminlerdir; takvim taahhüdü değildir. İlk dört iş tamamlanırken ileri dönem veri toplamaya devam edilmelidir.

## 5. Ayrıntılı bulgular ve öneriler

### 5.1. Aynı kanıtta AI etkisi sonraki kontrolde kaybolabiliyor — P0

**Gözlem:** [convictionAnalysis.js](../server/convictionAnalysis.js), `applyDecision` içinde AI sonucunu kural puanına çarpan olarak uygular. [eventWatch.js](../server/eventWatch.js), aynı kanıt yeniden görüldüğünde gerekçeyi ve `aiCertainty` değerini taşır; yeniden hesaplanan kural puanına önceki AI kararını uygulamaz. Geçiş durumu da bu ham puan üzerinden hesaplanır.

**Doğrulama F10:** Aynı haber, fiyat ve teknik veride kural puanı 90. AI certainty=0 ile puan 54, fırsat kapısı kapalı. Olay nöbeti sonrasında certainty hâlâ 0 iken puan 90 ve kapı açık. Gerçek AI çağrısı veya veritabanı yazımı yapılmadı.

**Yapılmalı:** Kural puanı, AI kararı ve nihai puan ayrı alanlar olmalı; bütün iş akışları tek nihai puan fonksiyonunu çağırmalı. Kapı kontrolü son puan hesaplandıktan sonra yapılmalı. Kanıt değişmişse eski karar geçersizleştirilmeli; aynıysa güncel kural puanına aynı karar tutarlı biçimde uygulanmalı. Model, prompt ve karar sürümü korunmalı.

**Benim görüşüm:** Raporun en acil sinyal düzeltmesi bu. Yeni bilgi olmadan bir adayın kalite kapısından geçmesi, bütün analiz anlatısına zarar verir.

**Kabul ölçütü:** Aynı veri ve aynı karar sürümü; aday üretimi, olay nöbeti ve arayüzde aynı nihai puan ve aynı kapı sonucunu üretmeli.

### 5.2. Kişisel portföy kâr/zararı için işlem defteri gerekiyor — P0/P1

**Gözlem:** [portfolioCalculations.js](../src/utils/portfolioCalculations.js), `getPortfolioSummary` hem maliyeti hem güncel değeri bugünkü kurla TL'ye çeviriyor. `getPortfolioPeriodProfit`, bugünkü miktarı geçmişte de elde tutulmuş kabul ediyor. [Portföy şeması](../supabase/portfolio-schema.sql) mevcut pozisyonların JSON listesini saklıyor; ayrı alım/satım ve nakit hareketleri defteri yok.

**Doğrulanan örnekler:**

| Senaryo | Mevcut sonuç | Doğru yorum |
|---|---|---|
| 10 adet hisse, alış/güncel fiyat 100 USD; alış kuru varsayımı 30, güncel kur 40 | Toplam TL kârı 0 | TL maliyet 30.000, değer 40.000: 10.000 TL fark. USD fiyat getirisi ise 0. F01 |
| Bugün 100 USD'den alınan 10 adet hisse; hissenin geçmiş dönem getirisi %25 | Geçmiş dönem kârı 8.000 TL | Bugün alınan pozisyonun o geçmiş dönemde gerçekleşmiş kazancı yok. F02 |
| Portföy değerinin yalnız %10'u için fiyat değişimi var, kur değişimi yok | `covered=true`, eksik kur %0 sayılıyor | Kapsam ve eksik kur açıkça belirtilmeli; tam portföy getirisi gibi sunulmamalı. F03 |

**Hızlı düzeltme:** İşlem geçmişi gelene kadar mevcut dönem hesabını “Bugünkü sepetin varsayımsal dönem değişimi” olarak adlandırmak. Toplam sonuçta “yerel para fiyat kazancı” ile “TL bazında yatırım kazancı” ayrılmalı. Eksik alış kuru varsa gerçek TL maliyeti uydurulmamalı.

**Kalıcı çözüm:** Alım, satım, para yatırma/çekme, temettü, komisyon, kur dönüşümü ve bölünme kayıtları; işlem zamanı, miktar, fiyat, para birimi ve ilgili kurla tutulmalı. Güncel pozisyonlar bu kayıtlardan türetilmeli. Aracı kurum CSV aktarımı eklenmeli; eski kayıtlar “açılış bakiyesi, tarihsel maliyet eksik” olarak taşınabilmeli.

Kullanıcının para yatırma zamanlarını içeren getiri için para ağırlıklı getiri; stratejiyi karşılaştırmak için nakit giriş/çıkışlarının etkisini ayıran zaman ağırlıklı getiri sunulmasını öneriyorum. Nakit akışları, işlem maliyetleri ve nakit getirilerinin tutarlı işlenmesi performans ölçümünün temelidir. Bu öneri bir GIPS uyumluluk beyanı değildir. [CFA Institute — performans hesaplama ilkeleri](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/overview-of-the-global-investment-performance-standards)

**Kabul ölçütü:** Örnek bir aracı kurum dökümü ile para birimi bazında mutabakat; F01–F03 için doğru sonuç veya açık “hesaplanamıyor” durumu; alıştan önce kâr yazılmaması.

### 5.3. “Bilinmiyor”, “düşük risk” olmamalı — P0

**Gözlem:** [portfolioAnalysis.js](../server/portfolioAnalysis.js) eksik temel verileri nötr katsayılarla tamamlıyor. Fiyat, bilanço ve haber alınamasa da skor ve risk sınıfı üretilebiliyor. [analyze-portfolio.js](../api/analyze-portfolio.js) kur tablosu yokken USD/EUR için 1 başlangıç değeri kullanıyor; bu da karma portföyün ağırlıklarını bozabilir. Ön yüzde ayrıca tarih bilgisi taşımayan sabit/son bilinen kurlar var.

**Doğrulama F05:** Hiç piyasa verisi olmayan örnekte hisse genel puanı 50, risk puanı 36, portföy risk seviyesi “Düşük” çıktı. Bu bir ölçüm sonucu değil, eksik veride çalışan varsayımlar.

**Yapılmalı:** Fiyat, kur, bilanço, teknik geçmiş ve haber için ayrı kapsam ve yaş bilgisi tutulmalı. Zorunlu veri yoksa ilgili ölçüm `null` ve nedeni ile dönmeli. Haber yokluğu ile haber servisinin çalışmaması ayrılmalı. Uzun vadeli kalite sepeti için asgari temel veri kapsamı zorunlu olmalı; yalnız iki yıllık fiyat serisinin bulunması “tam analiz” anlamına gelmemeli.

**Benim görüşüm:** Uygulamanın en önemli davranışlarından biri gerektiğinde “Bunu şu an güvenilir biçimde ölçemiyorum” diyebilmesi.

**Kabul ölçütü:** Fiyat/kur/bilanço kesintisi senaryolarında olumlu risk rozeti, yeni işlem uygunluğu veya tam portföy getirisi oluşmamalı. Eski sonuç varsa tarihiyle gösterilmeli.

### 5.4. Senkronizasyonda hata ve boş kayıt ayrılmalı — P0

**Gözlem:** [useSyncedState.js](../src/hooks/useSyncedState.js) okuma sonucundan yalnız `data` alanını alıyor. Hata sonucunda `data` boşsa, “kullanıcının kaydı yok” yoluna girip boş başlangıç portföyünü `upsert` etmeye çalışıyor. Sonraki yazma sonuçları da kullanıcıya bildirilmeden geçiliyor.

**Risk:** Geçici okuma hatası sonrasında yazma başarılı olursa mevcut portföy boş veriyle değiştirilebilir. İki cihaz da tüm JSON listesini yazdığı için eski bir cihaz güncel değişiklikleri ezebilir. Canlıda böyle bir kayıp yaşandığı doğrulanmadı; risk kod akışında mevcut.

**Yapılmalı:** “Kayıt yok”, “okuma başarısız” ve “yetki yok” durumlarını ayırmak; başarısız okuma ardından başlangıç kaydı yazmamak; son güvenilir yerel kopyayı korumak; kaydediliyor/kaydedildi/hata durumlarını göstermek. Sürüm numarasıyla çakışma kontrolü ve yeniden deneme eklemek. Oturum değişimi ve ekran kapanışında bekleyen yazmaları doğru kullanıcı kimliğine bağlamak ve temizlemek.

**Kabul ölçütü:** Zorlanmış okuma hatasında veritabanına boş yazma yapılmaması; iki cihazdaki çakışmanın sessizce veri silmemesi; kullanıcı değişiminde eski yazma zamanlayıcısının çalışmaması.

### 5.5. Giriş, bekleme ve geçersizleşme farklı durumlar olmalı — P0/P1

**Gözlem:** [priceLevels.js](../src/utils/priceLevels.js), giriş için `price <= high` koşulunu yeterli görüyor. Alt sınır ve bozulma seviyesi bu koşuldan önce kontrol edilmiyor. Destek bulunmadığında bandın alt sınırı dayanak oluyor. Tampon %3,5, bozulma payı %3 olarak sabit.

**Doğrulama F04:** Destek yok, bandın altı 100, güncel fiyat 90. Giriş bölgesi 100–103,5 ve bozulma seviyesi 97 olmasına rağmen durum `inside`, açıklama “giriş için uygun aralıkta”. Kaynak portföy seçicisinde ayrıca bozulma kontrolü var; ortak yardımcıdaki sorun bu nedenle bütün akışlarda aynı sonucu üretmiyor.

**Yapılmalı:** Önce `invalidated`, sonra bölgenin altında, içinde, yakınında ve üstünde durumları ayrılmalı. Bütün ekranlar aynı durum fonksiyonunu kullanmalı. Destek yoksa gösterilen planın dayanağı ve belirsizliği açık olmalı. Sonraki aşamada vade, oynaklık, spread ve olay riskine göre tamponlar değerlendirilmeli.

Giriş planına hedefe kalan mesafe, olumsuz senaryodaki kayıp, işlem maliyeti ve tez bitiş tarihi eklenmeli. Stop seviyesinin piyasa boşluğu durumunda garanti edilen gerçekleşme fiyatı olmadığı hesapta gözetilmeli.

**Kabul ölçütü:** Bozulma seviyesinin altındaki fiyat hiçbir ekranda uygun giriş sayılmamalı; giriş/çıkış kuralları simülasyonda da aynı çalışmalı.

### 5.6. Beklenen getiri ve güven puanı kalibre edilmeli — P1

**Gözlem:** [candidateBuilder.js](../server/candidateBuilder.js) beklentiyi benzer grafikler, banda dönüş ve analist hedeflerinden oluşturuyor. Güven, sürücü ağırlıkları ve yön birliğinden türetiliyor. Tek sürücüde yön birliği otomatik olarak tam oluyor. Aralık, tahmin etrafına oynaklık eklenerek hesaplanıyor; belirli bir gerçekleşme kapsamı için doğrulanmış tahmin aralığı değil.

**Doğrulama F06:** Yalnız 12 analistin ortalama hedefinden oluşan tek sürücü, 0,91 ve “yüksek” güven üretti. Bu 12 bağımsız başarılı tahmin anlamına da gelmez; veri tek bir toplulaştırılmış hedef alanı.

Ayrıca [technicalAnalysis.js](../server/technicalAnalysis.js) uzun analog için 60 işlem günü kullanırken beklenti motoru 252 gün istiyor. Vade eşleşmeyince bu analog beklentiye katılmıyor; uzun açıklamada 60 günlük analog yine anılabiliyor. İki vadeyi karıştırmamak doğru, ancak yöntem ve kullanıcı anlatımı buna göre düzenlenmeli.

**Yapılmalı:**

- Kalibrasyon tamamlanana kadar “yüksek güven” yerine “kaynak uyumu”; “olasılık tahmini” yerine “model senaryosu” gibi anlamı doğru ifadeler kullanmak.
- Uzun vadeyi açık bir standarda bağlamak; 60 ve 252 günlük sinyalleri ayrı isimlendirmek. Bir yıllık analogu beslemek için yeterli tarih yoksa sonuç üretmemek.
- Her tahmini değişmez biçimde kaydedip vade sonunda gerçekleşen getiriyi eşlemek. Beklenen/gerçekleşen getiri hatasını ve verilen aralığın kapsama oranını raporlamak.
- Aynı fiyat serisinden çıkan benzer grafik ve banda dönüşün tam bağımsız kaynaklar olmadığını dikkate almak.
- Güveni; veri kapsamı, etkin bağımsız örnek sayısı, geçmiş tahmin hatası ve kaynak uyumu olarak ayrı göstermek.

**Benim görüşüm:** Doğrulanana kadar ondalıklı güven sayıları kullanıcıya gereksiz kesinlik hissi verir. Tahminin nerede çalışmadığını göstermek daha değerlidir.

**Kabul ölçütü:** Her ufuk için gerçekleşme tablosu; uzun/kısa vade uyuşmazlığının giderilmesi; etiketlenen güvenin hangi ölçümden geldiğinin açık olması. %80 kapsamlı bir aralık sunulacaksa kapsamı bağımsız ileri dönemde ölçülmeli.

### 5.7. Ekranlar ortak analiz kaydından beslenmeli — P1

**Gözlem:** Kişisel analiz [portfolioAnalysis.js](../server/portfolioAnalysis.js) içinde daha hafif formüllerle; fırsatlar [candidateBuilder.js](../server/candidateBuilder.js) ve [opportunityScoringCore.js](../src/utils/opportunityScoringCore.js) ile hesaplanıyor. Risk tanımları da farklı. Model, değer ve kaynak sepetlerinde ayrı uygunluk kapıları var. Fırsat vitrininin 78 eşiği ile kısa model sepetinin 45 kanıt eşiği aynı şey değil.

Farklı stratejilerin farklı kapılar kullanması tek başına hata değildir. Kullanıcı aynı hisseye baktığında farkın nedenini göremiyorsa tutarlılık sorunu oluşur. Uzun vade sektör normalizasyonu da o çağrıya giren aday havuzuna bağlı; daha dar kaynak havuzu farklı bir puan üretebilir.

**Yapılmalı:** Ortak bir hisse analiz kaydı: varlık kimliği, piyasa, vade, veri zamanı, faktörler, veri kalitesi, kanıtlar, model sürümü. Strateji kapıları bu kayıttan türetilmeli ve “hangi strateji için uygun” açık yazmalı. Sektör referans evreni ve tarihi sabitlenmeli. Sunucu ve ön yüz eşikleri aynı sürümlü ayar kaynağından gelmeli.

**Kabul ölçütü:** Aynı varlık/vade/tarih/model sürümü için aynı temel ölçümler. Farklı karar varsa gösterilen sebep farklı veri değil, açık strateji kuralı olmalı.

### 5.8. İleri test, gerçekten kullanılan stratejiyi ölçmeli — P1

**Mevcut iyi taraf:** [backtest.js](../server/backtest.js) ve [backtestMetrics.js](../server/backtestMetrics.js) günlük sinyal tekrarlarını birleştiriyor, 20/252 seans ve maliyet sonrası sonuç hesaplıyor. Bu başlangıç korunmalı.

**Sınırlar:**

- Günlük tekrarlar birleştirilse de aynı hissenin ardışık günlerdeki 20/252 günlük getirileri büyük ölçüde örtüşür. Basit bağımsız örnek varsayımıyla hesaplanan t istatistiği fazla iyimser olabilir.
- Sonuç kovaları pazar içermiyor; ABD ve BIST aynı vade/puan bandında toplanıyor.
- Kapanış ve kaydedilmiş fiyat oranı kullanılıyor. Sinyalin yayımlanmasından sonraki uygulanabilir işlem fiyatı, spread, kayma ve kurumsal aksiyonlar için tek bir sözleşme yok. Bölünme etkisi özellikle doğrulanmalı.
- Test puan bandını ölçüyor. Fırsat kapısı, giriş bölgesi, pozisyon büyüklüğü, stop, hedef ve nakit kuralıyla çalışan tam stratejiyi doğrudan simüle etmiyor.
- “AI teyitli” ve “Kural” grupları aynı örnekler değil. Aralarındaki fark AI'ın katkısının nedensel ölçümü sayılamaz.
- Benchmark yoksa fazla getiri 0 dönebiliyor. F09 bunu doğruladı; doğru durum “hesaplanamıyor”.
- Ana çıktı iş akışı logunda. Sürüm bazında kalıcı deney raporu ve kullanıcıya dönük başarı paneli gerekiyor.

**Önerdiğim deney tasarımı:** Aynı tarihsel veri erişim sınırlarıyla; basit eşit ağırlık, mevcut kural sistemi, kural+AI ve seçili yeni risk kuralları karşılaştırılsın. Giriş sinyalden sonra mümkün olan fiyatla modellensin. Strateji sürümleri test başlamadan dondurulsun. Maliyetler normal ve yüksek varsayımla çalıştırılsın. Sonuçlar pazar, vade ve piyasa koşuluna göre ayrıştırılsın. Örtüşen örnekler için zaman blokları ve bağımlılığı gözeten belirsizlik hesabı kullanılsın.

Çok sayıda parametre arasından geçmişin en iyisini seçmek, ileri performansı olduğundan iyi gösterebilir. Denenen bütün sürümlerin kaydını tutma ve ayrılmış ileri dönemde doğrulama önerimin araştırma dayanağı budur. [Bailey ve diğerleri — The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf)

**Başarı ölçümü:** Maliyet sonrası benchmark farkı, günlük maksimum düşüş, işlem sayısı, devir hızı, kuyruk kayıpları, ortalama kazanç/kayıp ve veri kapsamı birlikte raporlanmalı. Sadece isabet oranı yeterli değildir: %60 başarıyla ortalama +%2 kazanç ve -%5 kayıp, maliyet öncesinde işlem başına yaklaşık -%0,8 beklenen sonuç verir. Bu yalnız açıklayıcı örnektir.

### 5.9. Performans bütün portföy türlerinde aynı dilde ölçülmeli — P1

**Gözlem:** Hazır portföylerde [modelPortfolioPerformance.js](../src/utils/modelPortfolioPerformance.js) ile TL bazlı fiyat getirisi ve bölünme düzeltmesi var. Temettüler hariç, nakit getirisi sıfır; bu sınır ekranda açıklanmış. Kaynak kıyası USD düzeltilmiş kapanış kullanıyor; kişisel portföy başka yöntemle hesaplanıyor. Manuel değer ve kaynak sepetlerinin ekranları hazır portföydeki günlük performans deneyimini sunmuyor.

**Yapılmalı:** Ortak performans servisi üzerinden ayrı ve açık seriler: fiyat getirisi, temettü dahil toplam getiri, işlem maliyeti sonrası net getiri, USD ve TL sonuçları. Nakit para birimi ayrıca kaydedilmeli: ABD hisseli bir sepette nakdin TL'de mi USD'de mi tutulduğu sonuçları değiştirir. Vergi uygulanacaksa hesap/ülke varsayımı ayrı olmalı.

Kur katkısı ile hisse katkısı ayrıştırılmalı. Her portföy için uygun benchmark önceden seçilmeli; farklı endeksler bilgi amaçlı ayrıca gösterilebilir. Altın için kullanılan `GC=F` serisinin vadeli kontrat referansı olduğu belirtilmeli; doğrudan yatırım yapılabilen altın ürününün toplam getirisiyle eşit sayılmamalı.

Günlük kayıtların borsa seansı, fiyat zamanı ve kur zamanı tutarlı olmalı; hafta sonu ve tatillerin risk hesabına yapay sıfır getiriler eklemesi önlenmeli. Hazır, manuel ve kaynak sepetleri yayımlandıkları sürümden itibaren izlenmeli.

**Kabul ölçütü:** Aynı işlem listesi aynı ölçüm seçeneğinde her ekranda aynı sonucu üretmeli. Gerçek hesap performansı, ileri dönem model takibi ve geriye dönük simülasyon açıkça ayrılmalı. Hipotetik performansın gerçek işlem sonucu olmadığı performans sunumunda temel bir ayrımdır. [SEC Investor.gov — Performance Claims](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-47)

### 5.10. Pozisyon büyüklüğü ve ortak risk ölçülmeli — P1

**Gözlem:** [modelPortfolioCore.js](../src/utils/modelPortfolioCore.js) ağırlıkları ağırlıklı olarak eşit pay, azami pozisyon ve sektör başına hisse sayısıyla belirliyor. Risk puanı sınıf etiketlerinin sayısal karşılıklarından türetiliyor. Korelasyon, ortak şirket, toplam portföyde tekrar eden maruziyet ve oynaklığa göre pozisyon riski hesaplanmıyor.

Somut bir örnek: [24 Eylül tarihli yerel kaynak raporunda](2026-09-24-source-comparison.md) aynı Dengeli Büyüme sepetinde GOOG ve GOOGL ayrı ayrı %12 yer alıyor. Şirket düzeyinde bu %24 Alphabet maruziyeti. Bu tarihli yerel rapordur; bugünkü canlı sepet olarak değerlendirilmemeli.

**Yapılmalı:**

- Hisse kodundan ayrı şirket/ihraççı kimliğiyle aynı şirketin pay sınıflarını birleştirmek.
- Kullanıcının bütün sepetlerini birlikte analiz etmek; üç sepette aynı şirketi tutmayı üç ayrı çeşitlendirme saymamak.
- Sektör ağırlığı, korelasyonlu kümeler, kur, piyasa ve tema maruziyetini göstermek.
- Pozisyon büyüklüğünü zarar mesafesi, oynaklık ve likiditeyle değerlendirmek; azami şirket/sektör sınırlarını ayrıca uygulamak.
- Likiditeyi piyasa değerinin yanında işlem tutarı, ortalama hacim ve spread ile ölçmek.
- Bilanço gibi olaylardan önceki boşluk riskini ve sert piyasa düşüşü senaryolarını göstermek.

Örnek araştırma hesabı: 100.000 TL sermaye, varsayımsal %0,5 işlem risk bütçesi ve %5 zarar mesafesi için ham pozisyon büyüklüğü 10.000 TL olur. Bu örnek kişisel risk tavsiyesi değildir; boşluk, kayma ve diğer portföy sınırları ayrıca uygulanır.

**Benim görüşüm:** Aday seçimi kadar, yanlış aday çıktığında ne kadar kaybedildiği üzerinde çalışılmalı. Önce basit ve açıklanabilir risk kuralları denenmeli; karmaşık optimizasyon ancak ileri testte ek yarar gösterirse kullanılmalı.

### 5.11. Gerçek veri zamanı ve fiyat yenilemesi düzeltilmeli — P1

**Gözlem:** [useLivePrices.js](../src/hooks/useLivePrices.js) ilk render'daki `refresh` fonksiyonunu aralıklı çalıştırıyor. Hisse listesi daha sonra değiştiğinde zamanlayıcı eski sembol listesini kullanabiliyor; boş başlayan portföy özellikle etkilenebilir. Elle yenileme güncel fonksiyonu kullanabilir, ancak otomatik akışın güncellenmesi gerekir.

Başarılı fiyat cevabında `lastUpdated` mevcut saate ayarlanıyor; fiyatın piyasa zamanı ve portföy kapsamı taşınmıyor. Boş bir fiyat haritası bile doğru bir “güncellendi” izlenimi verebilir. [liveData.js](../src/services/liveData.js) bulut yedeğine geçerken eski/eksik fiyatların durumunu ortak bir veri kalitesi nesnesiyle döndürmüyor.

**Yapılmalı:** Sembol listesi değişiminde yenileme aboneliğini güncellemek; fiyatları pozisyon kayıtlarından ayrı bir önbellekte tutmak. Veri zamanı, sunucunun aldığı zaman, son deneme ve son başarılı güncelleme ayrılmalı. Eksik semboller ve kapsanan portföy ağırlığı görünmeli. Bayatlık kuralları seans/tatil takvimine göre çalışmalı.

**Kabul ölçütü:** Sayfa açıkken eklenen hisse otomatik fiyat almalı; silinen hisse gereksiz sorgulanmamalı; kısmi veya eski yanıt “tüm portföy güncel” sayılmamalı. Her fiyat yenilemesi tüm portföy JSON'unu buluta yazmayı gerektirmemeli.

### 5.12. Haber sayısı yerine doğrulanmış ekonomik olay ölçülmeli — P1

**Gözlem:** [evidence.js](../server/evidence.js) kaynak sayısını yakın tarihlerde aynı geniş kategoriye uyan farklı yayıncı adlarından hesaplıyor. Farklı olaylar aynı teyit kümesine girebilir; aynı basın açıklamasını aktaran yayıncılar bağımsız doğrulayıcı gibi sayılabilir. [newsHeuristics.js](../server/newsHeuristics.js) basın bülteni dağıtıcılarını “Resmi Bildirim” olarak etiketliyor. Şirket açıklaması, bağımsız haber ve düzenleyici bildirim ayrı niteliktedir.

Hızlı bildirim kuralları olumlu katalizörlere odaklanıyor. Portföy sahibinin olumsuz tahmin güncellemesi veya tez bozulmasını erken görmesi de en az yeni fırsat kadar değerli.

**Yapılmalı:** Şirket, olay türü, dönem, olay kimliği, asıl kaynak ve yayın/algılama zamanını içeren olay kaydı kurmak. Kopya haberleri bir olay altında toplamak. “Doğrudan şirket açıklaması”, “düzenleyici bildirim”, “bağımsız haber” ve “yorum” ayrılmalı. Kaynak itibarı puanı, belgenin gerçekten doğrulandığı anlamına gelmemeli.

Haberin şirket gelirine/marjına etkisi, beklentiye göre sürprizi, finansman koşulu ve fiyatın haber sonrasında ne kadar hareket ettiği değerlendirmeye eklenmeli. Özellikle portföyde bulunan hisseler için olumsuz olay ve tez bozulma uyarıları geliştirilmesi uygun.

**Kabul ölçütü:** Aynı açıklamanın üç kopyası üç bağımsız kanıt sayılmamalı. Etiketlenmiş haber örnekleminde olumlu/olumsuz olay tespiti ve yanlış alarm oranı ölçülmeli. Bildirim başarısı yalnız hızla değil, kullanıcıya ulaştığında kalan karar değeriyle değerlendirilmeli.

### 5.13. Değer portföylerinde emsal kalitesi ve manuel eklemeler iyileştirilmeli — P2

**Gözlem:** [valueSelection.js](../src/utils/valueSelection.js) sektör havuzunda en az beş şirketle F/K ve PD/DD iskontosu arıyor; negatif/eksik çarpanı ucuz saymaması iyi. Ancak emsaller bütün sektör yerine seçilmiş aday havuzundan geliyor. Eksik cari oran bazı durumlarda sağlıklı kabul ediliyor. Sektörlerin aynı çarpanlarla ölçülmesi sınırlayıcı.

**Yapılmalı:** Alt sektör ve iş modeli bazında emsaller; sektörüne uygun nakit akışı, borç ve sermaye verimliliği ölçüleri; tek seferlik kâr etkilerinin ayrılması; emsal kapsamı ve finansal dönem bilgisinin gösterilmesi. BIST ve ABD verilerinin muhasebe/para birimi farkları ayrıca ele alınmalı. Veri kapsamı düzelmeden daha çok oran eklemek sınırlı yarar sağlar.

**Doğrulama F08:** Manuel hisse eklendikten sonra portföy metrikleri yeniden hesaplanmıyor. İki hisseli örnekte manuel hissenin beklenen getiri alanı yokken önceki %1,2 portföy beklentisi kalıyor. Bu, çekirdekteki “tüm yatırım kalemlerinde tahmin olmalı” kuralıyla çelişiyor. `PortfolioSet` bugün bu metriği göstermiyor; mevcut risk öncelikle saklanan verinin tutarlılığı ve sonraki tüketiciler.

Manuel tercih yetkisi korunmalı; her değişiklikten sonra ağırlık, kapsam, risk, şirket/sektör yoğunluğu ve beklenti yeniden hesaplanmalı. Kullanıcının eklemesi düşük risk etiketini otomatik olarak korumamalı.

**Kabul ölçütü:** Yetersiz emsalle ucuzluk kararı verilmemesi; manuel değişiklik sonrası saklanan bütün özetlerin nihai sepetten türetilmesi.

### 5.14. Kaynak portföylerinde geçmiş kazananı takip etmek ayrı bir hipotez — P2

**Gözlem:** [sourcePortfolios.js](../server/sourcePortfolios.js) iki yıllık toplam simülasyon getirisine göre ilk beş kaynağı seçiyor. %95 kapsam ve eksik fiyatı reddetme kontrolleri iyi. Ancak güncel yatırımcı listesi, ilk 20 hisse sınırı ve sabit 60 gün açıklama gecikmesi; yoğunlaşmış ve verisi erişilebilir portföylere doğru seçim etkisi yaratıyor. Bunların bir bölümü zaten arayüzde açıklanmış.

İki yıllık dönemde en çok yükselen kaynakların sonraki dönemde de daha iyi olacağı henüz ayrı bir ileri testle gösterilmeli. SEC 13F bilgileri çeyreklik ve gecikmeli olup kısa pozisyonları tam portföy resmi olarak içermez; sabit gecikme yerine belgenin gerçek kamuya açılma zamanını kullanmak daha doğru bir simülasyon sağlar. [SEC — Form 13F SSS](https://www.sec.gov/rules-regulations/staff-guidance/division-investment-management-frequently-asked-questions/frequently-asked-questions-about-form-13f)

**Doğrulama F07:** [sourcePortfolioPerformance.js](../src/utils/sourcePortfolioPerformance.js) düşüşü dönem uçlarında hesaplıyor. 100→50→110 günlük yolunda dönem düşüşü 0, gerçek günlük maksimum düşüş -%50. Alanın adı `periodDrawdownPct`; şu anda günlük maksimum düşüş diye sunulmuyor. Risk sıralaması geliştirilirken bu alan o amaçla kullanılmamalı.

**Yapılmalı:** Resmî bildirim zamanı ve o an bilinen kayıtları arşivlemek; kaynak seçim dönemini takip performansından ayırmak; günlük NAV ile düşüş ölçmek; benchmark, işlem maliyeti, yoğunlaşma ve seçimin istikrarını hesaba katmak. Eski ve yeni kaynak değişimlerinde devir hızını izlemek.

**Benim görüşüm:** Bu bölüm araştırma fikri üretmek için güçlü. Başkasının geçmiş başarısını bugünkü alım kararına otomatik çevirmek için yeterli kanıt henüz yok.

### 5.15. Kullanıcıya kararın yaşam döngüsü sunulmalı — P2

**Gözlem:** [Menü](../src/components/Sidebar.jsx) dokuz ana bölüm sunuyor. Fırsat, üç portföy ailesi, analiz, araştırma ve haber arasında bilgi zengin; “Bugün mevcut yatırımlarımla ilgili ne değişti?” sorusunun cevabı dağınık. Bu değerlendirme kod ve ekran bileşenleri üzerinden yapıldı; görsel kullanılabilirlik testi değil.

**Önerdiğim ana ekran:**

| Alan | Kullanıcıya verdiği cevap |
|---|---|
| Portföyümde değişenler | Hangi tez güçlendi, bozuldu veya veri bekliyor? |
| Yaklaşan olaylar | Hangi bilanço, makro açıklama veya karar maruziyetimi etkiliyor? |
| Yeni değerlendirmeler | Hangi aday neden, hangi vade ve veriyle gündeme geldi? |
| İşlem öncesi senaryo | Eklendiğinde toplam şirket/tema ağırlığı ve olumsuz senaryo ne olur? |
| Sonuç günlüğü | Önceki kararın beklenen ve gerçekleşen sonucu neydi? |

Her fikir; izleniyor, koşul bekliyor, değerlendirmeye uygun, kullanıcı tarafından işleme alındı, tez bozuldu, süre doldu ve kapandı durumlarıyla takip edilebilir. “İşlem yapmama” geçerli bir karar olarak kaydedilmeli.

Karar günlüğünde giriş tezi, karşı kanıt, o anki model sürümü, beklenen vade, gerçekleşen işlem ve çıkış nedeni tutulmalı. Böylece aynı davranış hataları ve işe yaramayan sinyal türleri görülebilir.

**Kabul ölçütü:** Kullanıcı tek hisse ekranından kararın kaynağına, riskine ve geçmiş sonucuna ulaşabilmeli; aynı şirketi tekrar tekrar araştırmak zorunda kalmamalı.

### 5.16. Otomasyonun sağlığı yatırım verisinin parçası olmalı — P1/P2

**Gözlem:** Haber, fiyat, derin tarama ve kaynak kıyası farklı aralıklarla çalışıyor. Bu ayrım uygun. Ancak zamanlanmış işin varlığı, işin zamanında bitmesi ve verinin doğru olması aynı şey değil. GitHub kendi dokümantasyonunda zamanlanmış işlerin yoğunlukta gecikebileceğini veya düşebileceğini belirtiyor. [GitHub — schedule davranışı](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

**Yapılmalı:** Her iş için son başarılı başlangıç/bitiş, beklenen-gerçek kapsam, fiyat/haber yaşı, hata nedeni ve son geçerli sürüm tutulmalı. Yeni veri bozuksa önceki sürüm korunmalı ve ekranda yaşı görünmeli. Kodda var olan kuyruk ve izleme altyapısı genişletilmeli. Yerel Express ve Vercel API yolları için aynı istek/yanıt sözleşmesini doğrulayan kontroller eklenmeli.

**Benim görüşüm:** Önce mevcut Vercel + Supabase + Actions düzeninde ölçülebilir güvenilirlik sağlanmalı. Daha hızlı bir veri sağlayıcı veya sürekli çalışan sunucu yatırımı, gecikmenin gerçekten kaçırılan karar değerine yol açtığı ölçülürse öncelik kazanır. Lisanslı ve kapsamı doğrulanmış veri, özellikle kısa vadeli stratejinin ekonomik fizibilitesinin bir parçasıdır.

## 6. Önerilen geliştirme planı

### İlk 1–2 hafta: karar güvenilirliği

1. AI puanı/olay nöbeti tutarsızlığını ve giriş bölgesi hatasını düzeltmek.
2. Eksik fiyat, kur ve bilanço için veri yetersiz durumlarını uygulamak.
3. Bulut okuma hatası sonrası boş yazmayı engellemek; kaydetme durumlarını görünür kılmak.
4. Gerçek geçmişi olmayan kâr/zarar alanlarını doğru adlandırmak; kapsamı göstermek.
5. Otomatik fiyat yenilemesinin değişen sembol listesini izlemesini sağlamak.
6. Bu denetimdeki senaryoları kalıcı, anlamlı regresyon testlerine dönüştürmek.

**Çıktı:** Kullanıcıya hatalı kesinlik veya yanlış kazanç gösterme riskinin belirgin biçimde azaltılması. Bu aşamadan getiri artışı yüzdesi beklemem; doğruluk ve önlenen hata ölçülür.

### 3–6. haftalar: ortak hesap ve analiz temeli

İşlem defteri ve CSV aktarımı; tarihsel kur, nakit, temettü ve maliyet hesabı; ortak varlık/şirket kimliği; analiz ve veri kalitesi sözleşmesi; bütün sepetlerde aynı performans yöntemi. Manuel eklemelerin özetleri yeniden hesaplanır. Piyasa/para birimi ve benchmark seçimi açık hale gelir.

**Çıktı:** “Ne kazandım, ne kadarını kur getirdi, ne kadar risk aldım?” sorularına tutarlı cevap.

### 7–10. haftalar: ölçülen yatırım süreci

Sürüm bazlı ileri test raporları, aynı adaylarda kural/AI karşılaştırması, işlem simülasyonu, günlük düşüş ve devir hızı ölçümleri; basit pozisyon büyüklüğü ve şirket yoğunluğu kuralları; karar günlüğü ve tez bozulma uyarıları.

**Çıktı:** Hangi geliştirmelerin maliyet sonrası fayda verdiğini değerlendirebilen sistem.

### Sonraki dönem: yalnız kanıtlanan iyileştirmeleri büyütmek

Haber olaylarının daha iyi ayrıştırılması, sektörlere uygun değerleme, kaynak stratejisinin ileri doğrulaması ve gerekirse veri sağlayıcı iyileştirmesi. Yeni eşikler ve stratejiler önce gölge portföyde izlenir.

**Takvim sınırı:** Bu süreler tek deneyimli geliştirici ve mevcut veri erişimi varsayımıyla planlama aralığıdır. Bir yıllık tahminin ileri doğrulaması 10 haftada bitmez; 252 seanslık sonuçlar olgunlaşana kadar “bekliyor” kalır. Veri toplama ilk günden sürmelidir.

## 7. Başarıyı nasıl ölçeceğiz?

| Alan | İzlenecek ölçüm | Karar kuralı |
|---|---|---|
| Hesap doğruluğu | İşlem/kur/temettü/komisyon mutabakatı | Açıklanamayan fark varsa performans onaylanmaz |
| Veri kalitesi | Ağırlık bazlı kapsam, gerçek fiyat yaşı, eksik temel veri | Stratejinin zorunlu verisi eksikse yeni uygunluk verilmez |
| Sinyal tutarlılığı | Aynı girdide iş akışları arası puan/kapı farkı | Fark sıfır olmalı; değişim nedeni kaydedilmeli |
| Tahmin | Beklenen-gerçekleşen hata, aralık kapsamı, örnek sayısı | Güven etiketi gözlenen sonuçlarla desteklenmeli |
| Yatırım sonucu | Maliyet sonrası uygun benchmark farkı | Pozitif farkın belirsizliği, düşüşü ve maliyet duyarlılığı birlikte incelenmeli |
| Risk | Günlük maksimum düşüş, kötü senaryolar, şirket/tema yoğunluğu | Önceden seçilmiş risk sınırları aşılırsa yeni risk azaltılmalı |
| Strateji istikrarı | Farklı ileri dönemlerde sonuç, devir hızı, tek hisseye bağımlılık | Tek dönem veya birkaç kazanan bütün başarıyı açıklamamalı |
| AI katkısı | Aynı adaylarda AI eklenmesinin net etkisi | Açıklama kalitesi ile yatırım katkısı ayrı ölçülmeli |
| Haber | Yanlış alarm, olay tekilleştirme, algılama/teslim gecikmesi | Bildirim hacmi başarı ölçüsü olmamalı |
| Kullanım | Kararı gerekçesiyle kaydetme ve sonradan değerlendirme | Kullanıcı daha sık işlem yapmaya değil, daha bilinçli karar vermeye yönelmeli |

Salt “100 işlem oldu” veya “3 ay geçti” başarı kanıtı değildir. Örneklerin bağımsızlığı, strateji ufku ve sonuçların belirsizliği değerlendirilmelidir. Kısa ve uzun vade için ayrı olgunlaşma takvimi kullanılmalı.

## 8. Ben olsam bütçeyi ve geliştirme zamanını nasıl ayırırdım?

İlk sıraya **sinyal tutarlılığı + doğru kâr/zarar + eksik veri kontrolünü** koyardım. Ardından işlem defteri, şirket düzeyinde risk ve ileri test panelini tamamlardım. Daha güçlü AI modeli, daha çok gösterge ve daha fazla kaynak eklemeyi bu temelin arkasına koyardım.

“Liste boş kalıyor, eşiği düşürelim” yaklaşımını kullanmazdım. Eşik; işlem sayısını artırmak için değil, maliyet sonrası sonuç ve risk dengesini geliştirdiği gösterildiğinde değiştirilmeli. Mevcut kurulum notlarında ve eşik açıklamalarında liste doluluğuna göre ayar öneren ifadeler de buna göre düzeltilmeli.

Ürünün değer önerisini şu yönde geliştirirdim: **Portföyündeki önemli değişiklikleri zamanında açıklayan, riskini görünür kılan, kararını kaydeden ve sonucunu doğru ölçen yatırım araştırma uygulaması.** Böyle bir temel, hangi stratejinin daha kârlı olduğunu sonradan güvenilir biçimde ortaya koymayı mümkün kılar.

## Ek: Tekrarlanabilir kanıtlar

Çalıştırma:

```text
node reports/2026-10-03-inceleme-kanitlari.mjs
```

| Kod | Doğrulanan davranış |
|---|---|
| F01 | Alış kuru etkisinin kişisel toplam TL kârında bulunmaması |
| F02 | Bugünkü pozisyonla geçmiş dönem kârı hesaplanması |
| F03 | Kısmi fiyat kapsamının tam kullanılabilir sonuç gibi işaretlenmesi ve eksik kur varsayımı |
| F04 | Bozulma seviyesinin altındaki fiyatın giriş bölgesinde sayılması |
| F05 | Piyasa verisi alınmadan düşük risk ve nötr skor üretimi |
| F06 | Tek sürücüyle yüksek güven; 60/252 seans uzun vade ayrışması |
| F07 | Dönem uçlarındaki düşüşün günlük maksimum düşüşü yakalamaması |
| F08 | Manuel ekleme sonrasında eski portföy beklentisinin korunması |
| F09 | Benchmark gözlemi yokken fazla getirinin sıfır dönmesi |
| F10 | Olay nöbetinin aynı kanıttaki AI puan indirimini kaldırması |

F07 yöntemin sınırını, F06 güven ölçüsünün niteliğini gösterir; her biri tek başına canlıda gerçekleşmiş zarar iddiası değildir. Senkronizasyon ve zamanlayıcı bulguları kod akışı incelemesine dayanır; bu betikte React yaşam döngüsü veya gerçek çok cihaz testi yapılmaz.

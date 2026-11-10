# Trade önerileri: gereksinimler ve veri denetimi

Denetim tarihi: **11 Kasım 2026**. Kapsam: bu depodaki ABD ve BIST hisse verileri; canlı hesaplara, ücretli veri aboneliklerine veya üretim sırlarına erişilmedi. Kodun mevcut olması, ilgili bağlantının üretimde kurulu olduğu anlamına gelmez.

## Karar

Mevcut fiyat ve aday toplama sıklığı saatlik/gün içi trade için yeterli değil. `server/index.js` fiyatı beş dakika önbellekliyor; `.github/workflows/collect-data.yml` 20 dakikada, aday üretimi altı saatte bir çalışıyor. `server/technicalAnalysis.js` günlük bar kullanıyor. Bunlar mevcut araştırma ve yatırım ekranları için korunabilir; saniyelik fiyat doğrulaması yerine kullanılamaz.

Trade akışı şu sırayı izlemeli: **lisanslı kaynak → kaynak zamanı ve piyasa durumu doğrulaması → gün içi göstergeler ve maliyet kontrolü → kısa ömürlü sinyal → kayıtlı cihaza bildirim**. AI açıklaması, çeviri veya altı saatlik aday turu bu yolun ön şartı olmamalı. Veri kapıları geçilmiyorsa hisse izleme kartı olarak gösterilmeli ve neden hazır olmadığı açıklanmalı.

## Olmazsa olmazlar ve elimizdeki durum

| Gereksinim | Bu depoda denetim öncesi durum | Trade için işlem / kalan ihtiyaç |
|---|---|---|
| Gerçek zamanlı fiyat, alış/satış, kaynak zaman damgası | Yahoo `mapQuote` fiyat ve `marketTime` içeriyor; alış/satış yok. Bulut toplayıcı `quotes` satırına kaynak zamanını yazmıyor; `updated_at` çekim zamanı. | Ayrı normalize edilmiş trade girdisi; fiyatın gerçekten oluştuğu zaman, sunucuya ulaşma zamanı ve kaynak adı ayrı tutulmalı. Çekim zamanını canlılık kanıtı saymama. Lisanslı kaynak bağlantısı gerekli. |
| Veri kapsamı ve kullanım hakkı | Gayriresmî Yahoo fiyatı; lisanslı BIST fiyat akışı kodda yok. | BIST için yetkili veri dağıtıcısı, ABD için kullanılan borsa kapsamı belirtilmiş feed. Tek borsalı hacmi konsolide piyasa hacmi gibi kullanmama. |
| Gün içi OHLCV | Günlük/haftalık fiyat tarihçesi mevcut; trade için kalıcı dakikalık akış yok. | Tamamlanmış, sıralı, boşluksuz dakikalık mumlar; sonradan düzeltme, tekrar ve sırasız kayıt kontrolü. En az gösterge ısınma penceresi. |
| Trend, momentum, volatilite, VWAP | Günlük RSI/MACD/ortalama ve analog modülü mevcut. | Gün içi barlardan ayrı ATR, RSI, trend ve hacim ağırlıklı fiyat. VWAP yalnız kullanılan pencereyi kapsıyorsa tüm seans VWAP'ı diye adlandırmama. |
| Likidite, spread, işlem büyüklüğü | Günlük hacim aday analizinde kullanılabiliyor; canlı spread yok. | Alış/satış farkı ve gün içi parasal hacim eşiği; dar likiditede hazır sinyal üretmeme. Emir defteri derinliği ek doğrulama sağlar, her strateji için zorunlu değildir. |
| Seans, tatil, erken kapanış, devre kesici | Yahoo `marketState`; hedge Python kodunda borsa takvimi var. Ortak anlık hisse durdurma akışı yok. | Kaynak tarafından doğrulanmış normal seans ve durdurma bilgisi; bilgisayar saatine göre hafta içi saymak yeterli değil. Durdurma/tatil bilinmiyorsa kapıyı kapat. |
| Haber/katalizör ve kanıt | Google/Yahoo haber arşivi; PR Newswire/GlobeNewswire RSS; isteğe bağlı Benzinga WebSocket. | Kaynak bağlantısı, yayın ve algılama zamanı birlikte kullanılmalı. RSS kapsam/gecikmesi görünür olmalı. Eski haber sırf bugün yeniden çekildi diye yeni katalizör sayılmamalı. |
| Bilanço, şirket olayı, makro risk | `marketIntelligence.js` bilanço tarihi/opsiyon/temel veri; `secData.js` SEC; `macroCalendar.js` BLS ICS ve sabit FOMC listesi. | Mevcut bağlamı trade motoruna taşı. Takvim eksikliği ve BIST/TCMB/TÜİK kapsamının bulunmamasını belirt. Sabit FOMC listesi tüm olayları kapsamaz; ertelenen tarihleri tek başına doğrulamaz. |
| Endeks, sektör, portföy bağlamı | Araştırma, aday skoru, portföy/takip listesi, hedge ve kur modülleri mevcut. | İzlenen semboller ve son aday kayıtları kapsam/bağlam olarak yeniden kullanılabilir. Günlük ucuzluk, analist hedefi, 13F veya kurumsal yatırımcı portföyü saatlik alım tetikleyicisi değildir. |
| Giriş, geçersizleşme ve çıkış | Mevcut fiyat seviyeleri yatırım vadeli. | Anlık alış fiyatı, ATR/teknik stop, kısa geçerlilik, net ödül/risk ve maliyet hesabı. Hedefe veya stopa ulaşma garantisi yok. |
| Risk seçenekleri | Saatlik trade senaryoları yok. | Daha yakın hedefi “görece temkinli”, uzak hedefi “agresif” diye karşılaştır; %3 artışın kendisini risksiz sayma. Aynı stopla daha uzak hedefte bekleme/gerçekleşmeme riski artar. |
| Tahmini trade süresi | Aday motoru 20/252 seans ufuklu. | Volatiliteye göre **işlem saati aralığı**; takvim saati veya vaat edilen satış saati değil. Belirsizlik açık olmalı. Bilanço/seans sonu gibi olaylar ayrıca geçersizleştirebilir. |
| Pozisyon büyüklüğü ve portföy riski | Portföy dağılımı mevcut; trade için risk bütçesi yok. | İşlem başına kayıp bütçesi / (giriş−stop+maliyet) ile teorik üst adet; toplam pozisyon, sektör yoğunluğu ve günlük kayıp sınırı kullanıcı/aracı kurum düzeyinde ayrıca kurulmalı. Bu özellik emir veya otomatik alım/satım içermez. |
| Telefona bildirim | VAPID, service worker, cihaz aboneliği, teslim ve tekrar deneme altyapısı mevcut. | Ayrı trade tercihi + cihazın trade konusuna açık aboneliği; kısa ömür, eski sinyali bastırma, aynı olayın tekrarını önleme. Sağlayıcı kabulü telefonda görünme teyidi değildir. |
| Sürekli çalışan düşük gecikmeli süreç | Vercel API ve cron; isteğe bağlı haber daemon'ları var. | Trade işçisi sürekli çalışan sunucuda; kaynak adaptörü ve heartbeat. Cron/GitHub Actions gerçek zamanlı veri akışı yerine geçmez. |
| İzleme ve hata davranışı | `monitor_status`, teslim logları mevcut. | Kaynak yaşı, alım gecikmesi, hesaplama, kayıt ve push sürelerini ayrı ölç. Bayat veri ve kesintide sinyali kapat; p50/p95/p99 ölçmeden “milisaniyelik” başarı iddia etme. |
| Strateji doğrulaması | `backtest.js` 20/252 seans ileri-test; günlük fiyat. | Gün içi trade'e özgü nokta-zaman veri, maliyet/kayma dahil walk-forward ve kâğıt işlem doğrulaması henüz yok. Mevcut backtest yeni motorun başarısını doğrulamaz. |

## Kaynak araştırmasından çıkan somut sınırlar

- Borsa İstanbul'un veri ürünleri ayrımı son fiyat ile en iyi alış/satış ve derinlik bilgisini ayrı ele alıyor. Bu yüzden yalnız son fiyata sahip olmak spread ve uygulanabilir giriş için yeterli değil. [Borsa İstanbul — Veri Yayın Ürünleri](https://www.borsaistanbul.com/veriler/veri-yayini/veri-yayin-urunleri)
- ABD verisinde IEX tek borsadır; SIP konsolide veridir. Bu bir sağlayıcı önerisi değil, hacim ve fiyat kapsamını kayıt altına alma gereğinin somut örneğidir. [Alpaca — Market Data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq)
- Kaynak akışları fiyat ve mum zamanları yanında durum/durdurma mesajları da sunabilir; sonradan gelen işlem mumları düzeltebilir. Adaptör bu farkları korumalıdır. [Alpaca — Real-time Stock Data](https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data)
- BIST'te sürekli işlem dışına geçiş ve devre kesici vardır; eşik ve seans uygulaması duyurularla değişebilir. Motor bunları sabit saat/yüzde varsayımı yerine yetkili kaynaktan almalıdır. [Borsa İstanbul — Piyasa İşleyişi](https://www.borsaistanbul.com/piyasalar/pay-piyasasi/piyasa-isleyisi)
- ABD tatilleri ve erken kapanışlar işlem saatini değiştirir. Süre gösterimi, normal seans ve zaman dilimi farkını korumalıdır. [NYSE — Holidays & Trading Hours](https://www.nyse.com/trade/hours-calendars)
- Stop fiyatı gerçekleşme fiyatını garanti etmez. Bu nedenle arayüzdeki stop, azami kesin kayıp veya garanti edilmiş satış olarak sunulmamalıdır. [FINRA — Stop Orders](https://www.finra.org/sites/default/files/notice_other_file_ref/Regulatory-Notice-16-19.pdf)
- Sık işlemde ücretler getiriyi azaltır; uygun risk bütçesi ve aracı kurumun hesap kuralları gerekir. [FINRA — Frequent Intraday Trading](https://www.finra.org/investors/insights/frequent-intraday-trading)
- iOS'ta standart Web Push, 16.4 ve sonrası ana ekran web uygulamalarında kullanılabilir. İzin kullanıcı etkileşimiyle alınmalı; yüksek öncelik hemen teslimi denemek içindir. Telefonda belirli sürede görünme garantisi vermez. [Apple — Sending Web Push Notifications](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- GitHub zamanlanmış işleri yoğunlukta gecikebilir veya atlanabilir; en sık zamanlama beş dakikadır. Bu nedenle trade tetikleme yolu cron olamaz. [GitHub — schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## Gecikmenin ölçülmesi

Tek bir “son güncelleme” alanı gecikmeyi açıklamaz. UTC olarak şu anlar saklanmalı: `marketTime` (kaynakta olay), `receivedAt` (bizim sunucuya varış), hesaplamanın başlama/bitişi, veritabanına kayıt, push isteğinin kabulü. Telefonun bildirimi gerçekten göstermesi ayrıca cihaz deneyi gerektirir.

`receivedAt − marketTime` veri iletim yaşını; `createdAt − receivedAt` uygulama işleme süresini gösterir. Sayfanın yenileme aralığı ve cihaz bildirimi bunların dışındadır. Sunucu saatleri senkronize olmalı; ileri tarihli, eksik veya bayat damga reddedilmelidir. Tamamlanmış bir dakikalık mumla çalışan stratejinin karar çözünürlüğü de doğal olarak bir dakikadır; fiyat akışını hızlandırmak bunu tick stratejisine dönüştürmez.

## Performansı doğrulama yöntemi

Bu bölüm yeni motorun başarısına ilişkin sonuç değil, uygulanması gereken deney tasarımıdır. Karar anında alınabilen bar/haber/kotasyon ve o anda bilinen takvim sürümü arşivlenir. Daha sonra düzeltilmiş veri ilk kararın girdisi gibi kullanılmaz. Parametre ayarı geçmiş bir eğitim aralığında yapılır; onu izleyen ayrı dönemlerde kilitli kurallarla yürüyen pencere testi yapılır. Sürekli sonuçlara bakıp aynı test aralığına göre eşik değiştirmekten kaçınılır.

Alımda ask, çıkışta bid, ücret ve kayma modele alınır. Aynı dakika içinde hedef ve stop birlikte görülüyorsa OHLC gerçek sırayı kanıtlamaz; tick veri yoksa temkinli stop-önce varsayımı açıkça yazılır. Yalnız kazanç oranı yerine net işlem başına beklenti, işlem sayısı, ortalama kazanç/kayıp, azami düşüş, likidite/kapsam kayıpları ve dönemler arası kararlılık raporlanır. Ardından değişmeyen kurallarla kâğıt işlem ve gerçek gecikme ölçümü yapılır. Günlük 20/252 seans backtest sonuçları bu deneyin yerine geçmez.

## Canlıya çıkmadan doğrulanacaklar

1. Lisanslı feed kapsamı, veri kullanım hakkı, sağlayıcı adaptörü, gerçek bid/ask ve doğru mum zaman anlamı.
2. Tatil/erken kapanış/durdurma bilgisinin kaynağı ve bilinmiyorsa sinyalin kapanması.
3. Bağlantı kesintisi, sırasız/tekrar/gelecek tarihli veri ve kısa sinyal ömrü denemeleri.
4. Maliyet/kayma dahil trade'e özgü geçmiş test ve ayrı dönem kâğıt işlem kaydı; yanlış sinyal, azami düşüş, maliyet sonrası beklenti ve hedef/stop sırası.
5. Aynı hesap/cihazda izinli bildirim, kapalı ekran, kesilen ağ, odak modu ve eski bildirimin bastırılması.
6. Üretimde p95 veri yaşı/hesaplama/kayıt/push süresi ve kesintiden dönüş kaydı. Ölçüm sonuçları olmadan hız veya kazanç beyan edilmez.

## Uygulama durumu — 11 Kasım 2026

Depoya Trade Önerileri sayfası, hisse gerekçeleri ve işlem saati aralıkları, hedef/stop senaryoları, maliyet içeren pozisyon hesabı, oturum doğrulamalı API, normalize veri girişi ve trade migration'ı eklendi. Motor gerçek zamanlı kaynak, para birimi, alış/satış, saat dilimli kaynak zamanı, doğrulanmış seans/durdurma durumu ve seans açılışından kesintisiz bir dakikalık bar kapsamını kontrol eder. Eski veya doğrulanmamış veri hazır sinyal üretmez. Haber, aday ve makro/şirket araştırma verileri bağlam olarak kullanılır; eksik takvim kapsamı belirtilir.

Sürekli worker kaynak feed'ini varsayılan bir saniyede sorgular; bağımsız bildirim döngüsü 500 ms aralıkla kuyruğu kontrol eder. Hisse yayınları en fazla dört paralel işlemle yapılır. Aday/haber bağlamının kısa önbelleği beş saniyedir; canlı fiyat önbelleği değildir. Maliyet modeli varsayılan 20 baz puan gidiş-dönüş ücret/kayma ve ayrıca ölçülen spread içerir. Trade bildiriminde hesap tercihi ve cihaz konu aboneliği birlikte gerekir; sinyalin ömrü en fazla 15 saniye, kullanıcı/sembol tekrar bekleme aralığı 15 dakikadır. Arayüz sunucu zamanına göre sinyal/bağlantı yaşını ilerletir; gecikmiş bir push eski işlem gerekçesi yerine süresinin dolduğunu gösterir.

Kullanıcı gerçek zamanlı veri sağlayıcısı olmadığını teyit etti. Bu nedenle ücretli/lisanslı feed ve sağlayıcıya özgü adaptör hâlâ dış kurulum ihtiyacıdır. Harici veritabanına migration uygulanması, üretim yayını, gerçek veriyle uçtan uca gecikme ve telefonda teslim bu çalışma kapsamında doğrulanmadı. Saatlik trade'e özgü replay/walk-forward ve kâğıt işlem performansı ölçülmedi; kod eklenmesi stratejinin kârlılığının veya belirli bir teslim süresinin kanıtı değildir. Yerel test/derleme sonuçları ayrı raporlanır.

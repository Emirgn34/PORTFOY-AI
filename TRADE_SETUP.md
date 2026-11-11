# Trade önerileri kurulumu

Bu özellik mevcut Vercel + Supabase uygulamasına eklenir. Yeni Sites projesi veya aracı kurum emir bağlantısı kurmaz. Kaynak araştırması ve mevcut veri envanteri: [trade gereksinimleri raporu](reports/2026-11-11-trade-gereksinimleri.md).

Yerel test veya üretim derlemesinin başarılı olması canlı veri, migration, ücretli abonelik veya gerçek telefon tesliminin doğrulandığı anlamına gelmez. Gecikmeli Yahoo verileri canlı trade sinyali ve trade bildirimi üretmek için kullanılamaz.

**11 Kasım 2026 durumu:** Kullanıcı gerçek zamanlı veri sağlayıcısı bulunmadığını belirtti. İlk `20261111_trade.sql` dosyasını Supabase SQL Editor'da çalıştırıp başarılı sonuç aldığını bildirdi. `ee16861` sürümünün GitHub'a gönderildiği, CI ve Vercel yayınının başarılı olduğu doğrulandı. Gerçek telefon teslimi veya canlı trade performansı doğrulanmadı. Sonraki denetim düzeltmeleri için aşağıdaki ek migration ve güncel kod birlikte yayımlanmalıdır.

## 12 Kasım 2026: tekrarlayan düşüş istatistiği ve 'pattern' bildirimleri

`supabase/migrations/20261112_pattern_alerts.sql` dosyasını SQL Editor'da
çalıştırın (notification_events konu kısıtına 'pattern' ekler). Trade worker
(`npm run trade:worker`) bağlam turunda ABD sembolleri için ücretsiz Yahoo
GÜNLÜK barlarından 50 günlük zirveye göre düşüş kovası (%15/20/25/30/40) ve
geçmiş benzer düşüşlerin 1/5/10 işlem günü ileri getiri istatistiğini hesaplar
(sembol başına en çok 6 saatte bir chart isteği). Taze (≤5 işlem günü) ve
geçmişte işe yaramış (≥3 örnek, 5 gün medyanı ≥ +%2, ≥%60 pozitif) düşüşlerde
bölüm başına TEK 'pattern' bildirimi üretilir; metin geçmiş istatistik olduğunu
ve tahmin/canlı sinyal olmadığını açıkça söyler. Migration kurulmamışsa worker
yalnızca uyarı loglar, başka hiçbir şey etkilenmez. Bildirim aboneliği
Trade sayfasındaki bildirim ayarlarında "Tekrarlayan düşüş uyarıları" kutusuyla
yönetilir. İstatistik TradePage detayında "Tekrarlayan düşüş istatistiği"
bloğunda görünür. Bu özellik tradeEngine'in canlı veri kapılarına DOKUNMAZ.

## 1. Veritabanı ve kod yayını

Önce mevcut `schema.sql`, kimlik ve `automation-schema.sql` kurulumunun tamamlandığını doğrulayın. `supabase/migrations/20261111_trade.sql` migration'ını Supabase SQL Editor'da uygulayıp aynı kod sürümünü mevcut Vercel projesine yayımlayın. `api/account.js` üzerinden `feature=trade` kullanılır; ayrı Vercel fonksiyonu gerektirmez. Trade tablolarına tarayıcıdan service-role anahtarıyla erişilmez.

İlk Trade kurulumu zaten yapılmışsa `supabase/migrations/20261111_trade_publication_order.sql` dosyasını da uygulayın. Bu ek dosya aynı fiyat zamanıyla gelen eski sinyalin işlem durdurmasını geri almasını önler; bilinen veri bağlantısı arızasında bekleyen trade bildirimini iptal eder. Tablo, portföy, abonelik veya kullanıcı tercihi silmez. Yeni veri akışını açmadan önce bu dosya ve güncel gönderici kodu birlikte devrede olmalıdır.

Bu güncellemenin kurulmasını salt okunur doğrulamak için SQL Editor'da:

```sql
select position('incoming_rank' in pg_get_functiondef('public.publish_trade_signal(jsonb,timestamptz,boolean,text)'::regprocedure)) > 0 as publication_order_installed,
       position('join monitor_status' in pg_get_functiondef('public.trade_delivery_allowed(text,uuid)'::regprocedure)) > 0 as feed_outage_guard_installed;
```

İki sonuç da `true` olmalıdır. Canlı veri yokken araştırma kartları gösterilir; zaman geçmesi tek başına canlı sinyali etkinleştirmez.

## 2. Gerçek zamanlı kaynak seçimi

Lisanslı sağlayıcınızın BIST/ABD kapsamını, en iyi alış/satış, normal seans, tatil/erken kapanış, durdurma ve dakika barı erişimini doğrulayın. ABD'de yalnız bir borsayı kapsayan feed, konsolide hacim değildir. BIST verisinin kullanım/gösterim/türetilmiş veri haklarını dağıtıcıyla doğrulayın. Bu kod herhangi bir veri aboneliği satın almaz; belirli bir sağlayıcı hesabını açmaz.

Sağlayıcıya özgü mesajları aşağıdaki ortak sözleşmeye dönüştüren **sunucu adaptörü** gerekir. Sağlayıcı anahtarını tarayıcıya veya `VITE_` değişkenine koymayın. `realtime` ve `sessionVerified` alanları adaptörün doğruladığı gerçek durumu taşımalıdır; bağlantıyı çalıştırmak için gelişigüzel `true` yapılmamalıdır.

## 3. Sunucu değişkenleri

Vercel'de mevcut `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` ve VAPID ayarlarını koruyun. Trade için `TRADE_LICENSED_SOURCE` (işletmenin lisanslı kaynak adı) ve `TRADE_INGEST_SECRET` (en az 32 karakterli ayrı sunucu sırrı) kullanılır. `TRADE_ROUND_TRIP_COST_BPS` gidiş-dönüş ücret/kayma varsayımıdır; varsayılan 20 baz puana ölçülen alış/satış farkı ayrıca eklenir. Bu değer gerçek aracı kurum maliyetinizin garantisi değildir. 1 baz puan = %0,01.

`TRADE_INGEST_SECRET` kullanıcı JWT'si veya Supabase anahtarı değildir. Aynı kaynak/sırrı yalnız güvenilir sunucu adaptöründe tutun. Sırları repoya, loga, komut argümanına veya sohbete yazmayın. VAPID anahtar çifti uygulama ve bildirim gönderen süreçlerde aynı kalmalıdır.

## 4. Normalize veri girişi

Adaptör HTTPS üzerinden `POST /api/account?feature=trade&action=ingest` çağırır. `Content-Type: application/json` ve `X-Trade-Secret` başlığı gerekir. İnsan kullanıcının oturum anahtarı bu giriş için kullanılmaz. Bu uç sadece sunucuda tanımlanan lisanslı kaynak adıyla kabul yapar.

Kısa adresler aynı fonksiyona yönlenir: `GET /api/trade`, `POST /api/trade/preferences` ve `POST /api/trade/ingest`. Kullanıcıya ait ilk iki uç Bearer oturumu ister; yalnız ingest sunucu sırrıyla çalışır.

Bir JSON gövdesi şu yapıya sahiptir; örnek zamanlar yalnız şemayı anlatır, canlı veri değildir:

```json
{
  "items": [
    {
      "symbol": "AAPL",
      "barIntervalSeconds": 60,
      "quote": {
        "name": "Apple Inc.",
        "currency": "USD",
        "price": 210.12,
        "bid": 210.11,
        "ask": 210.13,
        "marketTime": "2026-11-11T15:20:01.000Z",
        "sessionStartsAt": "2026-11-11T14:30:00.000Z",
        "sessionEndsAt": "2026-11-11T21:00:00.000Z",
        "marketState": "REGULAR",
        "realtime": true,
        "sessionVerified": true,
        "halted": false
      },
      "bars": [
        {
          "time": "2026-11-11T15:19:00.000Z",
          "open": 209.9,
          "high": 210.2,
          "low": 209.8,
          "close": 210.1,
          "volume": 120000
        }
      ]
    }
  ]
}
```

Örnekte okunabilirlik için tek mum var; hazır sinyal için aynı normal seansın açılışından itibaren en az 40 kapanmış bir dakikalık mum gerekir. `bars.time` **mumun açılış zamanıdır**, UTC/ISO biçimindedir. Motor ancak `time + 60 saniye ≤ değerlendirme zamanı` olan tamamlanmış mumları kullanır. `dataQuality.barTime` ise son kullanılan mumun **kapanış zamanıdır**. Adaptör sağlayıcının başlangıç/bitiş zaman anlamını bu sözleşmeye dönüştürmelidir.

Her güncellemede yalnız son mum yerine seans açılışından beri kesintisiz pencere gönderilir; bu kapsam seans VWAP'ını doğrulamak içindir. En fazla 500 mum mevcut BIST/ABD normal seans kapsamına yeter; pencere eksikse motor hazır sinyali kapatır. Semboller tekildir; BIST sembolleri `THYAO.IS` biçimindedir. Bir istekte en fazla 50 sembol ve sembol başına 500 mum kabul edilir. `sessionStartsAt` ve `sessionEndsAt` sağlayıcının o güne ait gerçek seans sınırlarıdır; tatil/erken kapanış günü normal gün saatleri körlemesine yazılmamalıdır. Kapanışa 30 dakikadan az kalınca yeni hazır sinyal üretilmez.

`marketTime` sağlayıcının gerçek kotasyon zamanıdır. Fiyat, mum ve seans zamanları açık saat dilimi içeren ISO biçiminde gönderilmelidir; UTC için `Z` kullanın. Saat dilimsiz metin geçerli girdiye dönüştürülmez. Sunucu kendi alım zamanını ayrıca `receivedAt` olarak koyar; eski fiyatın zamanını bugüne çekmez. Eksik alış/satış, para birimi, lisans bilgisi, seans doğrulaması, durdurma durumu veya geçersiz mumlar canlı sinyali engeller. Bayat fiyat tekrar tekrar gönderilerek taze sayılamaz.

Alternatif olarak normalize JSON'u üreten kendi HTTPS feed'inizi `TRADE_FEED_URL` ile tanımlayıp sürekli çalışan sunucuda `npm run trade:worker` çalıştırın. Bu sorgu yolu için **`TRADE_FEED_TOKEN` zorunludur**; Bearer kimlik doğrulamasında kullanılır ve yalnız sunucuda tutulur. Süreçte Supabase service-role ve VAPID değişkenleri de bulunmalıdır. `TRADE_POLL_MS=1000` varsayılan kaynak sorgu aralığıdır; kaynak, ağ, hesaplama ve kayıt süreleri ayrıca eklenir. Doğrudan ingest her yeni güncellemeyi iletebilir; worker modeli bir saniyelik sorgu aralığını ortadan kaldırmaz. Bir süreç yöneticisiyle yeniden başlatma, sağlık kontrolü ve saat senkronizasyonu kurun. GitHub cron veya kısa ömürlü Vercel fonksiyonu bu sürekli sürecin yerine geçmez.

Worker'daki bildirim döngüsü fiyat/haber sorgusundan bağımsız olarak 500 ms aralıkla kuyruğu kontrol eder; devam eden bir teslim döngüsüyle çakışmaz. Hisse kayıtları en fazla dört paralel işlemle yayımlanır. Aday/haber araştırma bağlamı beş saniye önbelleklenebilir; canlı fiyat bu önbellekten alınmaz. Bu aralıklar yapılandırma/uygulama davranışıdır, ölçülmüş telefon teslim süresi değildir.

`TRADE_RESEARCH_FALLBACK=true`, lisanslı feed yokken mevcut adaylardan araştırma kartı üretme yoludur; canlı veri hakkı veya canlı trade bildirimi açmaz. Varsayılan kalite kapıları fiyat yaşı için en fazla 15 saniye, son tamamlanmış mum için 90 saniyedir. Trade bildirimi ömrü en fazla 15 saniye, kullanıcı/sembol bildirim bekleme aralığı 15 dakikadır. Bu kısa pencere nedeniyle yavaş/çevrimdışı telefona eski fırsatı göndermek yerine sinyal atlanabilir.

## 5. Kullanıcı ve telefon

Kullanıcı giriş yaptıktan sonra menüden **Trade Önerileri** sayfasını açar. Kartlarda hisse, gerekçe, kaynak güncelliği ve tahmini işlem saati aralığı görünür. Karta tıklayınca görece temkinli/dengeli/agresif hedefler, stop ve maliyet sonrası ödül/risk incelenir. Hedef yüzdesi gerçekleşme garantisi değildir; skor kazanç olasılığı değildir.

Bildirim için hem hesapta Trade tercihi hem bu cihazın trade konusuna açık aboneliği gerekir. Sayfadaki telefon bildirimi bölümünden cihaz izni verilir ve Trade konusu seçilerek kaydedilir. Var olan haber/kaynak/kalkan konuları korunabilir. iPhone'da iOS 16.4 veya sonrası ana ekran web uygulamasından açın. [Apple'ın resmi Web Push belgesi](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)

Bildirim sinyali kısa ömürlüdür; eski veriyle yeniden gönderim yapılmamalıdır. Push sağlayıcısının isteği kabul etmesi kilit ekranında görünme teyidi değildir. Telefonun ağ, odak ve enerji ayarları gecikmeyi etkiler. Üst süre veya kesintisiz teslim garantisi verilemez.

## 6. Canlı doğrulama

1. Oturumsuz state çağrısının 401, yanlış adaptör sırrının 401 dönmesini doğrulayın. Kullanıcı kimliği gövdeden seçilememelidir.
2. Geçerli normal seanstaki gerçek veriyle kaynak zamanı, alım zamanı ve kartın son kullanım zamanını karşılaştırın. Bilinçli gecikmeli fiyat ve bağlantı kesintisinde hazır sinyalin kapanmasını kontrol edin.
3. Durdurulmuş hisse, kapanmamış/boşluklu mum, gelecekteki zaman ve eksik bid/ask senaryolarında canlı sinyal/bildirim oluşmamalıdır.
4. Hesap Trade tercihi kapalı ve cihaz Trade konusu kapalıyken bildirim çıkmamalıdır. Aynı sinyal tekrarlandığında aynı cihaza yeniden olay yağmamalıdır.
5. Yeni ve geçerli bir sinyalin veritabanı olayını ve push kabul kaydını kontrol edin. Ardından gerçek telefonda ekran kapalıyken görünmeyi ayrı deneyin. Test verisi üretime gerçek sinyal gibi gönderilmemelidir.
6. İşlem maliyeti/kayma dahil trade'e özgü geçmiş test ve ayrı dönem kâğıt işlem sonuçlarını toplayın. Mevcut günlük backtest raporları yeni saatlik motorun başarısı sayılmaz.

Üretim gecikmesini kaynak → alım → hesaplama → kayıt → push kabulü olarak ayrı ölçün. p50/p95/p99 ve veri kaybı/kesinti oranı görülmeden “milisaniyelik” veya “anında teslim” beyan etmeyin. Gereksinim eşiği ve sayfa yenileme aralığı hedef/ayar değeridir; ölçülmüş hizmet seviyesi değildir.

# PortföyAI devreye alma ve kurulum kontrol listesi

## 28 Ekim 2026: kişisel portföy sırası ve paylaşım görseli

Yalnızca kod yayını gerekir; yeni SQL, anahtar veya zamanlayıcı yoktur.
`package.json` ve kilit dosyası dnd-kit bağımlılıklarıyla birlikte yayımlanır.
Kişisel sıra mevcut `portfolios.stocks` dizisinin sırası olarak saklanır.

- Telefonda hissenin yanındaki tutamacı yaklaşık 300 ms basılı tutup yukarı/aşağı
  taşıyın. Bilgisayarda fareyle sürükleyin veya tutamaca odaklanıp okları kullanın.
  Kolon sıralaması geçicidir; `Kişisel sıra` kayıtlı düzene geri döner.
- Kayıt tamamlandığında hesap/cihaz bilgisi gösterilir; hata varsa `Kaydı tekrar dene`
  kullanılabilir. Sayfayı yeniden açıp, ardından aynı hesapla başka cihazdan kontrol edin.
- `Hisseye Göre Dağılım` kartını sağa kaydırın veya `Paylaşım görseli` seçin.
  Koyu turkuaz görselde yalnızca hisse kodları ve yüzdeler bulunur. `PNG indir`
  kullanılabilir; dosya paylaşımını destekleyen tarayıcılar ayrıca `Paylaş` sunar.
  Görsel tarayıcıda üretilir; paylaşım menüsünün açılması otomatik gönderim yapmaz.

Otomatik testler ve SVG çıktısının görsel kontrolü yerelde yapıldı. Gerçek telefonda
uzun basma, sayfa kaydırma ve PNG indirme/paylaşma yayın sonrası doğrulanmalıdır.
Ayrıntılar `reports/2026-10-28-portfoy-duzeni-dorduncu-asama.md` dosyasındadır.

## 28 Ekim 2026: hedge yenileme takibi

Önce `supabase/migrations/20261028_hedge_refresh_tracking.sql`, ardından GitHub ve
Vercel kod yayını uygulanır. Yeni anahtar veya zamanlayıcı kurulmaz. Mevcut dakikalık
haber çağrısı seans saatlerinde hedge işinin gerekip gerekmediğini de kontrol eder;
son analiz 15 dakikadan eskiyse otomatik iş başlatılabilir. Haber hatası ile hedge
hatası ayrı tutulur. Ayrıntılar ve canlı doğrulama sorgusu `HEDGE_SHIELD_SETUP.md`
dosyasındadır. Yayın sonrası gerçek bir manuel istekte çalışma ve tamamlanma
zamanları doğrulanmadan yeni iş takibi canlıda doğrulanmış sayılmaz.

## 28 Ekim 2026: ücretsiz haberleri hızlandırma

Kurulum sırası ve doğrulama sorguları `NEWS_SCAN_SETUP.md` dosyasındadır.
Önce `supabase/migrations/20261028_news_scan.sql`, sonra kod yayını, ardından Vault
ayarları ve `supabase/news-cron-setup.sql` uygulanır. Bu son dosya dakikalık işi
pasif bırakır; bildirim göndermeyen bağlantı kontrolü başarılı olduktan sonra
`supabase/news-cron-enable.sql` ile etkinleştirilir.

Beş ücretsiz RSS akışı en fazla dört eşzamanlı istekle okunur, uygun yeni haberler toplu kaydedilir
ve diğer kaynaklar/çeviri beklenmeden bildirim gönderimi tetiklenir. İlk gönderimde
Türkçe olay özeti, sonrasında tam başlık çevirisi kullanılır. Dakikalık çağrı Supabase
Cron'dan mevcut Vercel fonksiyonuna yapılır; ek sunucu hesabı veya ek Vercel
fonksiyonu gerekmez. Ücretsiz platform kotaları geçerlidir. Ortak kilit, GitHub
fallback ve daemon ile aynı anda ikinci bir RSS taraması yapılmasını önler.

Canlı kontroldeki GlobeNewswire 403 yanıtı sonrasında resmi `rss.globenewswire.com`
bilanço adresi (kategori 13) kullanıldı, sözleşme akışı (kategori 7) eklendi ve
RSS kategori alanındaki ABD hisse kodları da okunmaya başlandı. Bu kaynak
düzeltmesi kod yayını gerektirir; yeni SQL veya anahtar ayarı gerektirmez.

## 28 Ekim 2026: bildirim gönderimi ve cihaz abonelikleri

Önce mevcut kurulumda `supabase/migrations/20261028_push_delivery_retries.sql`
çalıştırılır, ardından uygulama ve mevcut haber işçileri güncellenir. Migration
tekrar çalıştırılabilir; eski olayları, abonelikleri veya teslimleri silmez.
`automation-schema.sql` sıfırdan kurulumda aynı yeniden deneme kuralını içerir.

- Gönderici geçerli olayların tüm sayfalarını okur; en eski 100 kayıt yeni haberleri
  gizleyemez. Yeni algılanan olaylar önce gönderilir. Abonelik sayfalaması kimlikle
  ilerler; süresi dolmuş bir cihazı silmek sonraki sayfadaki cihazları atlatmaz.
- En fazla beş cihaz eşzamanlı işlenir. Geçici ağ, 408, 429 ve sunucu hataları en
  fazla sekiz denemeyle ele alınır. Denemeler arası asgari bekleme 15, 30, 60 ve
  ardından 120 saniyedir; yeniden deneme bir sonraki işçi turunda gerçekleşir.
  Haber süresi dolduysa yeniden gönderilmez. Bu bekleme ayrı bir zamanlayıcı kurmaz.
- 404/410 abonelikleri kaldırılır; diğer kalıcı gönderim hataları `failed` kalır.
  Gönderim özeti `monitor_status` içinde `push` kimliğiyle, hata sayıları işçi
  loglarında tutulur. Endpoint, anahtar veya sağlayıcının ham hata metni yazılmaz.
- Cihaz ekranı kapalı izni, sunucuda eksik kaydı ve süresi dolmuş/anahtarı değişmiş
  aboneliği ayırt eder. Yenileme kullanıcının düğmeye basmasıyla yapılır.

`sent` ve mevcut `delivered_at` alanı push sağlayıcısının isteği kabul ettiğini
gösterir; telefonda görüntülenme teyidi değildir. Canlı doğrulamada aynı VAPID
anahtarlarının uygulama ve işçilerde bulunduğunu, gerçek yeni haber için teslim
kaydını ve ekran kapalıyken telefonda görünmesini ayrı ayrı kontrol edin.

Bildirim gönderimi düzeltmesi tek başına tarama sıklığını değiştirmez. Dakikalık
toplama ayrı kurulumla yukarıda açıklanmıştır; 15 dakikalık bildirim ömrü korunur.

## 24 Ekim 2026: Portföy Kalkanı

SQL migration, hesap UUID'si, CRON secret, manuel analiz bağlantısı ve telefon
testi adımları `HEDGE_SHIELD_SETUP.md` dosyasındadır. Mevcut React/Vite uygulaması,
Vercel fonksiyon sayısı ve mevcut push abonelikleri korunur. Bu kurulum
tamamlanmadan kalkan otomasyonu canlıda etkin kabul edilmez.

## 24 Eylül 2026: değer portföyleri, hızlı haberler ve kaynak takibi

Mevcut yayın Vercel + Supabase + GitHub Actions üzerinde kalır. Yeni bir Sites/Cloudflare
projesine taşınmaz. Yerel derleme tek başına canlı sistemi etkinleştirmez.
Yeni işlemler `/api/account?feature=automation` üzerinden sunulur; Vercel fonksiyon
sayısı mevcut 12 adette kalır. Ücretsiz plan için ek fonksiyon gerektirmez.

1. Önce Supabase SQL Editor'da `supabase/automation-schema.sql` çalıştırılır.
   Yeni tablolar yalnızca doğrulanmış sunucu API'sinden erişilebilir; istemci doğrudan
   yazamaz. Eski aylık portföy ve NAV tabloları değiştirilmez.
2. Aynı VAPID anahtar çifti Vercel, GitHub Actions ve varsa sürekli çalışan haber
   sunucusuna eklenir: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
   Anahtar üretimi: `npx web-push generate-vapid-keys --json`. Özel anahtarı repoya,
   ön yüz değişkenlerine veya sohbet mesajına yazmayın. Anahtarları her yayında değiştirmeyin.
3. Kod mevcut Vercel projesinde yayımlanır. `/sw.js` JavaScript ve
   `/manifest.webmanifest` JSON olarak erişilebilir olmalı; SPA yönlendirmesi bunları
   HTML'e çevirmemelidir. HTTPS gereklidir. Telefonda ana ekran uygulamasını yeniden açın,
   Haberler → Hızlı Şirket Haberleri → Bildirimleri etkinleştir düğmesine basın.
4. GitHub Actions → **Portfoy ve Bildirim Otomasyonu** → Run workflow → `quick` ile
   kuyruk ve arşiv haber taramasını; `sources` ile ilk iki yıllık kaynak karşılaştırmasını
   başlatın. Sonrasında quick 5 dakikada, sources her gün 04:17 UTC'de planlanır.
   Haber ve değer analizi bağımsız işlerdir; uzun analiz haber taramasını bekletmez.
   Quick, PR Newswire ve GlobeNewswire ücretsiz RSS açıklamalarını doğrudan okur;
   ücretli haber aboneliği gerekmez. Gelir/tahmin akışları ayrıca izlenir. Yalnızca
   başlıkta olay ve açıklama özetinde ABD hisse kodu tespit edilenler alınır.
   Daha sık ücretsiz kontrol için sürekli bir sunucuda `npm run news:free` 60 saniyede
   bir çalışır. RSS yayın ve kapsam gecikmesini ortadan kaldırmaz.
   GitHub zamanlamaları gecikebilir. Kuyruktaki işler en fazla 30 dakikalık lease ile
   alınır; başarısız analiz eski sepetleri değiştirmez. Aylık ABD kapsamına geçiş,
   bir sonraki Aday Üreticisi turunda eski dönemi gerçek NAV ile kapatarak yapılır.
5. **Saniyelik haberler için ayrıca** lisanslı Benzinga WebSocket haber erişimi ve
   sürekli çalışan bir sunucu gerekir. O sunucuda Supabase ve VAPID ayarlarına
   `BENZINGA_API_KEY` eklenip `npm run news:stream` bir süreç yöneticisiyle çalıştırılır.
   Vercel fonksiyonu veya GitHub cron sürekli WebSocket yerine geçmez.
   Kod bağlantıyı tekrar kurar, son mesajları replay ile ister ve heartbeat yazar.
   Replay sağlayıcının son 100 iletisiyle sınırlıdır; uzun kesintide haber kaçabilir.
   Ücretli bağlantı isteğe bağlıdır. Olmadığında ücretsiz RSS ve mevcut 20 dakikalık
   haber toplayıcısının arşivi taranır. Arayüz bunları açıkça **aralıklı kontrol**
   olarak gösterir; gerçek zamanlı diye etiketlemez.

### Seçim ve karşılaştırma sınırları

- Manuel çalışma, son ortak aday havuzundaki ABD hisseleri ile manuel eklenenleri
  yeniden derin analiz eder; her tıklamada tüm ABD borsasının ön taramasını yapmaz.
  90% analiz kapsamı gerekir. Her kullanıcıda tek bekleyen iş ve 5 dakika tekrar sınırı vardır.
- Ucuzluk aynı sektörün analiz havuzunda en az 5 şirketin pozitif F/K ve/veya PD/DD
  medyanıyla ölçülür. En az %10 iskonto, pozitif kâr marjı ve negatif olmayan satış
  büyümesi gerekir. Tam sektör evreni değildir. Manuel ekleme ayrı işaretlenir.
- Kaynak karşılaştırması Dataroma yatırımcı listesini ve çeyreklik ilk 20 hisse
  tarihçesini okur. İki takvim yılı, USD bazında düzeltilmiş kapanışlar, varsayımsal
  60 günlük açıklama gecikmesi, kalan ağırlığa %0 nakit getirisi kullanılır.
  **Gerçek fon getirisi veya gerçek bildirim tarihlerine dayalı kusursuz bir backtest değildir.**
  Bildirim tarihi, açığa satış, türev, ücret ve işlem maliyeti kapsam dışıdır. Güncel
  yatırımcı listesi ve sonradan düzeltilmiş tarihçe seçilim/geçmişe bakış yanlılığı taşır.
- Her kullanılan dönemde en az %95 ağırlık kapsamı ve eksiksiz düzeltilmiş fiyat
  gerekir; aksi halde yatırımcı sıralanmaz. Verisi eksik semboller sessizce atılmaz.
  Kaynakların %10'dan fazlası alınamazsa önceki sonuç korunur. Sonuçta en yüksek
  simülasyon getirili 5 kaynak seçilir; kaynak hisselerinden normal kalite/risk
  kurallarını geçen ve giriş bölgesinde/yakınında olanlarla 4 sepet oluşturulur.
- 49 bağlantının tamamı kaynak kütüphanesinde yer alır; otomatik karşılaştırma yalnız
  Dataroma'ya bağlıdır. Diğer sitelerin otomatik izlendiği iddia edilmez. SEC EDGAR
  mevcut Araştırma Merkezi'ndeki resmi bildirim kontrolünde kullanılmaya devam eder.
- Bildirimler ilk abonelikten önceki olaylar için gönderilmez. Haberlerin bildirim
  ömrü 15 dakika, kaynak değişimininki 6 saattir. Aynı olay/cihaz için teslim kaydı
  tutulur; geçici hata en fazla 8 kez denenir, 404/410 abonelikleri kaldırılır.
  Teslim sonrası veritabanı kesintisinde tekrar olasılığı vardır; telefon aynı `tag`
  ile bildirimi değiştirir. Telefonun odak/enerji/ağ ayarları teslimi geciktirebilir.
- Hızlı haber başlıkları mevcut ücretsiz çeviri servisiyle Türkçeleştirilir; özgün
  başlık açılabilir alanda korunur. RSS ve arşiv taraması çeviri beklemeden Türkçe
  olay özeti kaydeder ve bildirimi tetikler; tam başlık daha sonra çevrilir.
  Eski haber metinleri arka planda güncellenir; kimlik, algılama/son kullanım zamanı
  ve bildirim teslim kayıtları değişmediği için eski haber yeniden bildirilmez.

### Canlı doğrulama

Yerelde 62 sunucu/hesaplama/veritabanı testi, 49 arayüz testi ve üretim derlemesi
geçti. API testi başka kullanıcı kimliğiyle veri istemeyi ve başka hesaba bağlı
bildirim aboneliğini değiştirmeyi de kontrol eder. Tarayıcı ve gerçek telefon
teslim testi bu oturumda yapılamadı. İki yıllık salt okunur kaynak çalışmasının
sonucu `reports/2026-09-24-source-comparison.md` dosyasındadır: 69 yatırımcıdan
15'i veri koşullarını geçti. Bu rapor canlı veritabanına aktarılmadı.

Yerel testler ve build sonrası yukarıdaki kurulum uygulanmalı. Canlıda bir manuel
işin `queued → running → completed` olması, ayrı sürüm kaydı, mevcut aylık kayıtların
korunması, kaynak çalışmasının zaman damgası ve opt-in yapılmış telefonda ekran
kapalıyken bildirim teslimi doğrulanmalıdır. Kurulum uygulanmadan başarı beyan edilmez.

## Güvenli geri dönüş

Değişiklik öncesi proje `backup/pre-improvements-20260809` Git dalında korunur.
Eski sürümü incelemek veya tekrar çalıştırmak için backup dalına geçmek
yeterlidir; dalı silmeyin.

## 1. Supabase migration'ları

Supabase SQL Editor'da sırasıyla çalıştırın. Her dosya bir kez çalıştırılır;
tekrar çalıştırmak zararsızdır (hepsi `if not exists` / `create or replace`).

| Dosya | Ne kurar | Çalıştırılmazsa ne olur |
|---|---|---|
| `supabase/schema.sql` | tracked_symbols / quotes / fx_rates / news | Canlı veri hiç birikmez |
| `supabase/auth-schema.sql` | profiles + RLS + giriş duvarı | Giriş sistemi çalışmaz |
| `supabase/portfolio-schema.sql` | portfolios (hesaba bağlı portföy) | Portföy cihazlar arası senkron olmaz |
| `supabase/watchlist-schema.sql` | watchlists | Takip listesi senkron olmaz |
| `supabase/analysis-schema.sql` | portfolio_analyses | Portföy Analizi kaydedilemez |
| `supabase/ai-control-schema.sql` | Claude cache + maliyet sayacı + kullanıcı kotası | **Analiz çalışır ama AI yorumu ÜRETİLMEZ** |
| `supabase/backtest-schema.sql` | Backtest epizotları | Backtest raporu boş kalır |
| `supabase/model-portfolios-schema.sql` | Dört hazır portföy snapshot'ı + güvenli tarama kuyruğu | Hazır Portföyler yalnız demo/fallback gösterir |

`ai-control-schema.sql` çalıştırılmadığında uygulama çökmez; deterministik
fallback ile çalışır. Artık bu durum **arayüzde de görünür**: Portföy Analizi
sayfasında "AI kota tablosu kurulu değil…" notu çıkar.

## 2. Ortam değişkenleri

`.env.example` referanstır. Nereye ne konacağı:

**Vercel → Settings → Environment Variables (Production)**

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
SEC_USER_AGENT=PortfoyAI/1.0 iletisim@alanadiniz.com
AI_DAILY_BUDGET_USD=1.00
PORTFOLIO_AI_DAILY_LIMIT=5
PORTFOLIO_AI_CACHE_HOURS=6
PORTFOLIO_AI_COOLDOWN_SECONDS=300
VITE_ENABLE_MOCK_DATA=false
VITE_CONVICTION_THRESHOLD=78
```

**GitHub → Settings → Secrets and variables → Actions**

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
CONVICTION_THRESHOLD=78
```

`VITE_` önekli değişkenler tarayıcıya gömülür — service_role anahtarını ASLA
`VITE_` ile tanımlamayın. Maliyet değişkenleri tanımsızsa kod güvenli
varsayılanlara düşer (bütçe $1/gün, kullanıcı başına 5 analiz/gün).

### Bir değişkenin gerçekten geçtiğini doğrulama

`VITE_` değişkenleri **build sırasında** gömülür; Vercel'de ekledikten sonra
yeniden deploy şarttır. Doğrulamak için canlı sitenin bundle'ında değeri arayın
(ör. `VITE_SUPABASE_URL` için proje kimliğinin bundle içinde geçmesi gerekir).

## 3. Kanıt kapısı kalibrasyonu

`CONVICTION_THRESHOLD` (varsayılan 78) artık **ortam değişkeni** — ayarlamak için
kod değişikliği/deploy gerekmez, Vercel + GitHub'da değeri değiştirip yeniden
çalıştırmak yeterlidir.

Kalibrasyon canlı veri ister; sentetik senaryolarla yapılan ilk ayar henüz
gerçek turla doğrulanmadı. Sıra:

1. GitHub → Actions → **Backtest Raporu** → Run workflow.
2. Rapordaki 20/252 işlem günü sonuçlarına bakın.
3. Fırsatlar sürekli boşsa eşiği düşürün, çok doluysa yükseltin.
4. Her değişiklikten sonra bir sonraki raporu bekleyin — tek turda karar vermeyin.

## 4. Doğrulama

```bash
npm test
```

`npm test` iki katmanı birden koşar:

- `npm run test:unit` — sunucu, skor motoru, maliyet hesabı (`node --test`)
- `npm run test:ui` — React bileşenleri, **production kod yolunda** (`vitest`)

Arayüz testleri `MOCK_ENABLED=false` ile koşar; demo veri fallback'i kapalıyken
ortaya çıkan (ve dev'de asla görünmeyen) hatalar bu sayede yakalanır.

```bash
npm run build
```

# Portföy Kalkanı kurulumu

## 28 Ekim 2026: iş takibi ve güvenilir yenileme

Mevcut kurulum için önce
`supabase/migrations/20261028_hedge_refresh_tracking.sql` çalıştırılır, sonra yeni
kod GitHub/Vercel'e yayımlanır. Önceki `20261024_hedge_radar.sql` kurulmuş olmalıdır.
Yeni migration tekrar çalıştırılabilir; eski analiz, portföy ve push abonelikleri
silinmez. Güncelleme sonrasında eski migration'ı tek başına yeniden uygulamayın;
yenileme takibi migration'ı en son uygulanmalıdır.

Yeni ortam değişkeni, Vault kaydı veya ayrı zamanlayıcı gerekmez. Haberler için
etkinleştirilmiş dakikalık Supabase çağrısı, New York hafta içi 09:30–16:05 aralığında
hedge işinin gerekip gerekmediğini de kontrol eder. Son analiz 15 dakikadan yeniyse
yeni otomatik iş başlatılmaz. Tatil/erken kapanış ve bildirim kuralları Python
borsa takviminde doğrulanır. GitHub zamanlanmış işi fallback olarak devam eder.
Hedge başlatma hatası başarılı haber taramasının durumunu değiştirmez.

- Aynı anda etkin bir iş varsa mevcut istek döndürülür; yeni iş üretilmez.
- İstek `queued → running → completed/failed` durumlarından geçer. Gerçek GitHub
  çalışma kimliği, bağlantısı ve istek revizyonu saklanır.
- Başarılı analiz sonrası manuel bekleme beş dakika; başarısız iş sonrası manuel
  bekleme 30 saniyedir. Otomatik başarısızlık denemeleri beş dakikadan sık yapılmaz.
- Kuyrukta/çalışırken 15 dakikalık süre aşılırsa yeniden başlatılabilir. Eski işin
  sonradan gelip yeni isteği tamamlaması veya eski sonuçla üzerine yazması engellenir.
- Paket kurulumu veya testler başarısız olsa da işin ilk/son adımları durumu bildirir.
  Panel ayrıca gerçek GitHub sonucunu ve süre aşımını kontrol eder.
- Analiz kaydedildikten sonraki bildirim hatası analizi başarısız saymaz. Bekleyen
  bildirim olayı korunur. Finansal hesap, koruma oranı ve emir davranışı değiştirilmedi.
- Seans açılış/kapanışları mevcut ve sonraki seans için kaydedilir. Gece eski
  `market_open` kaydı nedeniyle yanlış gün içi gecikme uyarısı üretilmez; ertesi
  seans açıldığında önceki seans verisi güncel sayılmaz.

Kod yayını sonrası Portföy Kalkanı'nda **Şimdi Analiz Et** ile bir istek başlatın.
Panelde sırada/çalışıyor durumu ve ardından yeni veri zamanı görünmeli. SQL denetimi:

```sql
select refresh_status,refresh_version,refresh_source,
  refresh_requested_at,refresh_started_at,refresh_completed_at,
  refresh_retry_at,refresh_run_url,refresh_error,updated_at,
  diagnostics->>'as_of' as price_as_of
from public.hedge_radar_state where id=1;
```

İş akışı başarısı tek başına yeni analiz kanıtı değildir; `updated_at`,
`refresh_completed_at` ve fiyatın `as_of` zamanı birlikte kontrol edilir.
Piyasa kapalıysa son tamamlanan seans hesaplanır ve işlem bildirimi gönderilmez.
GitHub runner gecikmesi ve fiyat sağlayıcısının erişimi/sınırları devam edebilir.

Mevcut uygulama React 18 + Vite + React Router + Vercel Functions kullanıyor.
Next.js'e taşınmadı. `src/components/HedgeShieldDashboard.tsx`, `/portfolio`
ana sayfasına eklendi. Dört yeni URL, `vercel.json` üzerinden mevcut
`api/account.js` fonksiyonuna yönlenir; Vercel fonksiyon sayısı artmaz.

## 1. Supabase

SQL Editor'da, mevcut `supabase/automation-schema.sql` kurulmuşken
`supabase/migrations/20261024_hedge_radar.sql` dosyasının tamamını çalıştırın.
Migration tekrar çalıştırılabilir. Mevcut push abonelikleri silinmez.

`push_subscriptions` zaten `user_id`, `endpoint`, `subscription.keys`, `topics`
alanlarını içeriyor. İkinci bir abonelik tablosu oluşturulmaz. Kalkan konusuna
abonelik mevcut haber/kaynak tercihleri korunarak eklenir.

Supabase Authentication → Users ekranından kendi kullanıcı UUID'nizi alın.
Alternatif olarak SQL Editor'da:

```sql
select id, username from public.profiles order by username;
```

Tek satır şartı nedeniyle radar tek bir kullanıcıya atanır. `HEDGE_RADAR_USER_ID`
bu UUID'dir; diğer hesaplar bu portföyü göremez ve bildirimlerini alamaz.
Başka kullanıcıya ait portföyler birleştirilmez. Hedef hesaptaki `portfolios.stocks`
boşsa sekiz varsayılan hisse eşit ağırlıklı izlenir ve panelde açıkça belirtilir.
Boş olmayan bir portföyde veri eksikse varsayılan portföye sessizce geçilmez.

## 2. Ortam değişkenleri

| Değişken | Vercel Production | GitHub Actions Secrets |
|---|---|---|
| `SUPABASE_URL` | Mevcut değer | Mevcut değer |
| `SUPABASE_SERVICE_ROLE_KEY` | Mevcut gizli değer | Mevcut gizli değer |
| `HEDGE_RADAR_USER_ID` | Kendi kullanıcı UUID'niz | Aynı UUID |
| `CRON_SECRET` | Üretilen rastgele değer | Aynı değer |
| `VAPID_PUBLIC_KEY` | Mevcut değer | Mevcut değer |
| `VAPID_PRIVATE_KEY` | Mevcut gizli değer | Mevcut gizli değer |
| `VAPID_SUBJECT` | Mevcut `mailto:` değeri | Mevcut değer |
| `HEDGE_GITHUB_TOKEN` | Aşağıdaki sınırlı GitHub tokenı | Gerekmez |
| `HEDGE_GITHUB_REPOSITORY` | `Emirgn34/PORTFOY-AI` | Gerekmez |

GitHub Actions **Variables** bölümüne `HEDGE_APP_URL=https://portfoy-ai-ukyt.vercel.app`
ekleyin. Özel alan adınız varsa bu HTTPS adresini kullanın; login veya deployment
protection isteyen preview adresi kullanmayın.

`HEDGE_GITHUB_TOKEN`: GitHub → Settings → Developer settings → Fine-grained
personal access tokens. Yalnız `Emirgn34/PORTFOY-AI` reposunu seçin; Repository
permissions → **Actions: Read and write** verin. `Contents` yazma izni gerekmez.
Süre sonunu takip edin. Bu token yalnız Vercel sunucusunda tutulur. Kullanıcının
“Şimdi Analiz Et” isteği kuyruğa alınır; GitHub işi başlatılınca Python analizi
yapar ve panel 30 saniyede bir sonucu kontrol eder. GitHub kuyruğu nedeniyle
eşzamanlı/saniyelik sonuç garantisi yoktur. Başarılı analiz sonrasında beş dakika,
başarısız iş sonrasında manuel yeniden denemede 30 saniye bekleme vardır.

### Anahtar üretimi

PowerShell'de yeni CRON secret üretin; çıktıyı yalnız yukarıdaki iki gizli ayara koyun:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

VAPID anahtarları zaten kuruluysa **yeniden üretmeyin**; anahtar değişimi mevcut
cihaz aboneliklerini geçersiz kılar. İlk kurulumda gerekirse:

```powershell
npx.cmd web-push generate-vapid-keys --json
```

JSON'daki `publicKey` → `VAPID_PUBLIC_KEY`, `privateKey` → `VAPID_PRIVATE_KEY`.
`VAPID_SUBJECT=mailto:gercek-iletisim-adresiniz` kullanın. Hiçbir özel anahtara
`VITE_` öneki koymayın; dosyaya veya repoya commit etmeyin.

## 3. Yayın ve ilk çalıştırma

1. Yukarıdaki migration ve ayarları tamamlayın, kodu mevcut Vercel projesinde yayımlayın.
2. GitHub Actions → **Akilli Portfoy Kalkani** → **Run workflow**.
3. `Kalkan durumunu guncelle` adımında `published: true` ve hesaplanan rejimi kontrol edin.
4. Kendi hesabınızla `/portfolio#hedge-shield` açın. Hisse listesi, değerleme zamanı,
   beta ve varsayılan portföy uyarısını kontrol edin.
5. “Şimdi Analiz Et” → sıraya alınma → panelde yeni veri akışını doğrulayın.
6. Telefonda **Bildirimleri Aktif Et** düğmesine basın ve sistem iznini kabul edin.
   iPhone'da iOS 16.4+ Safari → Paylaş → Ana Ekrana Ekle, sonra uygulamayı o simgeden
   açın. Android'de desteklenen güncel tarayıcıdan uygulamayı yükleyin.
7. Bir sonraki gerçek rejim geçişinde ekran kapalıyken bildirimi ve bildirime
   dokununca kalkan panelinin açıldığını doğrulayın. İlk abonelikten önceki olaylar
   gönderilmez. OS izinleri, güç tasarrufu ve ağ teslimatı etkileyebilir.

API uçları:

- `GET /api/hedge-radar`: JWT + radar sahibi hesabı.
- `POST /api/hedge-radar/refresh`: JWT + etkin işi tekrar kullanma + duruma bağlı bekleme + GitHub dispatch.
- `GET/POST/DELETE /api/notifications/subscribe`: mevcut kullanıcıya bağlı push API'si.
- `POST /api/notifications/trigger`: `x-cron-secret` başlığı; mesajı istek gövdesinden
  değil veritabanındaki güncel radar durumundan alır. Rejim geçişi/kapanış olayı tekilleştirilir.

## 4. Finansal uygulama ayrıntıları

- Günlük SMA50, ATR14 (Wilder), hacim ortalaması önceki **tamamlanmış** seanslardan;
  haftalık/aylık EMA'lar tamamlanmış takvim mumlarından hesaplanır. Gün içi fiyat ve
  hacim ayrı okunur. 100 tamamlanmış ayı olmayan RKLB/ASTS gibi hisselerde EMA100M
  boş gösterilir; sayısal destek uydurulmaz.
- Beta: aynı 60 tamamlanmış QQQ getiri tarihine hizalı, güncel ABD spot pozisyon
  değerleriyle ağırlıklandırılmış `Cov(Rp,Rm)/Var(Rm)`. Eksik fiyat/getiri, sıfır
  endeks varyansı veya bayat gün içi fiyat varsa yeni durum yayımlanmaz.
- Öncelik: EMA50 haftalık bölgesi → doğrulanmış günlük kırılım veya bağımsız
  EMA20 haftalık kırılımı → SMA50 altı tuzak → SMA50'nin %0–1,2 üstü destek → güvenli.
  Haftalık EMA20 kırılımı kullanıcı tarifindeki ayrı risk kuralıdır; günlük
  hacim/ATR filtrelerinden bağımsızdır ve panelde bu şekilde yazılır.
- Günlük kırılım: kapanış penceresi veya (`VIX > 22` ve `QQQ < -%2,5`) +
  `fiyat < SMA50 - 0,4×ATR14` + `hacim/orijinal 20 seans ortalaması >= 1,1`.
- Kırılım + zayıf SOXX veya EMA20 haftalık kırılımında %100; diğer doğrulanmış
  günlük kırılımda %50 nominal koruma. Diğer rejimlerde aktif koruma sıfırdır;
  panelde %50/%100 alternatif senaryolar ayrıca incelenebilir.
- Örneğin β=1,55, %50 koruma: SQQQ `%25,83`, PSQ `%77,50`.
  Bunlar **alternatif** senaryolardır. SOXS için SOXX'e, SH için SPY'a karşı ayrı
  beta hesaplanır. SOXX, SOXS endeksine vekildir; baz farkı vardır.
- Ters/kaldıraçlı ETF hedefleri günlüktür. Günler boyunca sabit koruma veya kâr
  garantisi yoktur. Hisse/hedge emirleri gönderilmez; mevcut hedge pozisyonlarının
  maliyeti bilinmediğinden “kârla kapandı” sonucu üretilmez.

ABD düzenli seansı 09:30–16:00 New York saatidir. Yazın son 30 dakika TR
22:30–23:00, kışın 23:30–00:00'dır. Motor `exchange_calendars` ile tatil/erken
kapanışları kontrol eder. Cron her 30 dakika tarar; UTC 19:45/20:45 özel teyitleri
ve erken kapanış kontrolleri eklenmiştir. GitHub cron gecikebilir; eski saatle
“kapanış onayı” uydurulmaz. Seans dışı manuel analiz son kapanışı gösterir ve
telefona işlem alarmı göndermez.

## 5. Doğrulama

```powershell
npm.cmd test
npx.cmd tsc -p tsconfig.hedge.json
npm.cmd run build
python -m venv .tmp/hedge-venv
.tmp/hedge-venv/Scripts/python.exe -m pip install -r requirements.txt
.tmp/hedge-venv/Scripts/python.exe -m unittest discover -s test -p 'test_hedge*.py'
.tmp/hedge-venv/Scripts/python.exe scripts/hedge_engine.py --manual
```

Son komut gerçek verilerle varsayılan izleme listesini **salt okunur** analiz eder.
`--apply` olmadan veritabanına yazılmaz, bildirim gönderilmez. `--apply` yalnız
sunucudaki gizli ayarlar tamamlandıktan sonra kullanılmalıdır.

Finansal referanslar:
[Nasdaq seansları](https://www.nasdaq.com/market-activity/stock-market-holiday-schedule?display=b2b),
[ProShares SQQQ](https://www.proshares.com/our-etfs/leveraged-and-inverse/sqqq),
[Direxion SOXS](https://www.direxion.com/product/daily-semiconductor-bull-bear-3x-etfs.),
[yfinance](https://pypi.org/project/yfinance/).

Bu oturumda kod, yerel SQL/RLS ve gerçek verili salt okunur hesap doğrulandı.
Canlı SQL migration'ı, yeni gizli ayarlar ve gerçek telefonda teslim testi,
bu kurulum adımları tamamlanmadan etkin/doğrulanmış sayılmaz.

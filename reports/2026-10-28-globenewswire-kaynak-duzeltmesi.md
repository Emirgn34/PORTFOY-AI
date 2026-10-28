# GlobeNewswire kaynak düzeltmesi — 28 Ekim 2026

## Canlı gözlem

Kullanıcının Supabase sonucu, 28 Ekim 15:35 İstanbul saatindeki taramanın
`runner=supabase-cron`, `connected=true`, `interval_seconds=60`, `duration_ms=1587`,
`successful_sources=3`, `new_articles=0` ve `GlobeNewswire: HTTP 403` olduğunu
gösterdi. Bu, dakikalık çağrının ve üç PR Newswire akışının çalıştığını doğrular.
GlobeNewswire erişimi ve gerçek telefon teslimi bu sonuçla doğrulanmış sayılmaz.

## Bulgular ve uygulama

Resmi RSS dizininde bilanço/işletme sonuçları kategorisi 13, sözleşmeler kategorisi
7 olarak listelenir. Eski adreste kullanılan 1 ise Advisory kategorisine aittir.
Adresin açıklama bölümünde earnings yazması kategori numarasını düzeltmez.

- Bilanço adresi resmi `rss.globenewswire.com/en/RssFeed/subjectcode/13-...`
  adresine geçirildi. Sözleşmeler için aynı resmi listeden kategori 7 eklendi.
- İstekler uygulamayı dürüstçe `PortfoyAI/1.0 (RSS reader)` olarak tanıtır.
  Proxy, tarayıcı taklidi veya engel atlatma yöntemi eklenmedi.
- Bazı hisse kodları yalnız RSS `category` alanındadır. Okuyucu artık bu alandaki
  Nasdaq/NYSE/AMEX kodlarını da alır. ISIN, OTC, TSX ve TASE tek başına ABD hisse
  kodu sayılmaz. Yinelenen kodlar temizlenir; sınıf hisselerinde nokta tireye çevrilir.
- Beş akış için eşzamanlılık dörttür. Akış adı ve HTTP durum kodu tanıda saklanır;
  403 diğer akışları durdurmaz ve başarılı bağlantı gibi gösterilmez.

## Doğrulama

`npm.cmd run test:unit`: **106/106 başarılı**. Yeni senaryolar kategori alanı,
yabancı/OTC kodların reddi, dört istek sınırı ve akış adıyla 403 tanısını kapsar.
Arayüz, zamanlayıcı ve anahtar yönetimi kodu bu değişiklikte değiştirilmedi.

Beş resmi akış uygulama kimliğiyle salt okunur olarak kontrol edildi; beşi de
HTTP 200 ve 20 öğe döndürdü. Bilanço akışında 19, sözleşme akışında 11 öğede
desteklenen ABD hisse kodu okunabildi. Sözleşme akışında bir öğe mevcut olay
filtresini geçti. Bu örnek haber veritabanına yazılmadı veya bildirim gönderilmedi.

Bu kontrol yerel ağdan yapıldı. Vercel ağındaki 403 sorununun giderildiği, yeni
kod yayımlanmadan ve sonraki `monitor_status` sonucu görülmeden iddia edilmez.
Kaynak veya zamanlayıcı ayarı için yeni SQL, Vault kaydı veya gizli değer gerekmez.
Yayından sonra ideal sonuç beş başarılı akış ve boş hata listesidir.

## Resmi kaynak

https://rss.globenewswire.com/en/Rss/List

# Hedge yenileme güvenilirliği — 28 Ekim 2026

## Kapsam ve durum

Kullanıcının üçüncü maddesi: geciken analiz, sonuçlanmayan manuel istek ve ardından
beş dakika bekleme mesajı. İkinci madde olan haber toplamada beş akışın HTTP 200
ile çalıştığı kullanıcının canlı Supabase sonucu ile doğrulandıktan sonra bu aşamaya
geçildi. Gerçek yeni haberin telefonda görüntülenmesi ayrıca gözlemlenmelidir.

Kullanıcı hedge SQL'ini uyguladı ve `50d18cc` kod yayınının Ready olduğunu bildirdi.
İlk canlı iş yeni revizyon/run ID takibiyle başarıyla analiz kaydetti. Paneldeki
görünüm ve kullanıcı düğmesiyle yeni manuel istek ayrıca doğrulanacak.

## Canlı çalışma doğrulaması

28 Ekim 17:39 İstanbul saatinde istek revizyonu 8 için iş kaydı, hesaplama ve
tamamlama adımları başarıyla çalıştı:
https://github.com/Emirgn34/PORTFOY-AI/actions/runs/40708040185

Logda `started: true, revision: 8`, ardından `published: true` görüldü. Fiyat
`as_of` zamanı İstanbul 17:35 idi. Son kurulum kontrolündeki dört kontrol de true
olarak döndü. Son adım `unfinished_run_marked_failed: false` ile başarılı analizin
başarısız sayılmadığını doğruladı. Yeni rejim bildirimi oluşmadığı için gönderim
sayısı 0'dı; bu çalışma gerçek telefonda bildirim görüntülenmesini doğrulamaz.

## Bulgular

28 Ekim 01:06 İstanbul saatindeki son manuel GitHub işinin logu, hesaplamanın
yaklaşık dört saniyede tamamlanıp `published: true` ile kaydedildiğini gösterdi:
https://github.com/Emirgn34/PORTFOY-AI/actions/runs/40592124994

Bu örnek motorun her zaman çalışmadığı iddiasını doğrulamaz. Kodda ise aşağıdaki
aksaklıklar görüldü:

- Manuel API GitHub çağrısının kabulünü bildiriyor, gerçek iş kimliğini saklamıyor.
- SQL, başarı/hata ayırmadan son isteğe göre beş dakika bekletiyor.
- Kurulum veya test hatası motorun hata yakalama bloğundan önce olursa `queued`
  durumu korunabiliyor. Çalışan iş ayrı durum olarak izlenmiyor.
- Worker başlarken güncel istek numarasını okuyabiliyor; eski iş daha yeni manuel
  isteğin sonucunu sahiplenebiliyor.
- Bildirim tetikleme hatası, kaydedilmiş analizi de `failed` yapabiliyor.
- Arayüz kaydedildiği andaki `market_open` değerini kullanıyor. Gece veya ertesi
  seans eski piyasa durumu yanlış gecikme/kapalı piyasa görünümü oluşturabiliyor.
- GitHub zamanlanmış işleri gecikebilir. Seans dışında çalışan eski schedule
  kodu hesaplama yapmadan başarılı çıkabiliyor; iş akışı başarısı analiz kanıtı değil.

## Uygulama

İstek revizyonu ve gerçek GitHub run ID birlikte saklanır. Yeni API GitHub
2026-03-10 sürümündeki dispatch cevabından iş kimliğini alır; 204 cevabı veren eski
akışlarda worker başladığında kendi kimliğini kaydeder. Yanıttan gelen keyfi URL
kullanılmaz; bağlantı yapılandırılmış depodan oluşturulur.

`reserve_hedge_radar_refresh` etkin işi tekrar kullanır. Başarı sonrası manuel
bekleme beş dakika, başarısız iş sonrası 30 saniyedir. Otomatik başarısızlıklar
beş dakikadan sık denenmez. Bekleme gerçek sunucu durumuna göre döner ve panelde
saniye geri sayımı görünür. İş başlatılamazsa veya tamamlanmazsa eski analiz korunur.

Worker ilk adımında `running` durumuna geçer; bu adım finansal paketleri beklemez.
Kurulum/test/hesaplama sonunda sonuç kaydedilmediyse son adım işi başarısız yapar.
Hard timeout veya bu bildirimin yapılamaması durumunda API gerçek GitHub sonucunu
ve 15 dakikalık süre aşımını da izler. İzleme bağlantısının geçici hatası devam eden
analizi başarısız saymaz. Kabul edilmiş işin kimlik kaydı geçici olarak yazılamazsa
worker kimliği tekrar kaydeder; iş bu nedenle başarısız yapılmaz.

Finansal yayın fonksiyonunun mevcut hesap/olay mantığı korundu; etrafına revizyon,
run ID ve tamamlanma denetimi eklendi. Eski iş yeni isteği değiştiremez. Başarılı
analizden sonraki bildirim hatası analizi bozmaz; bekleyen bildirim korunur.

Mevcut dakikalık haber çağrısı New York hafta içi 09:30–16:05 aralığında hedge
yenilemesine gerek olup olmadığını da kontrol eder. Son analiz 15 dakikadan eskiyse
otomatik GitHub işi başlatılabilir. Tüm çalışma ve bekleme kapıları veritabanında
uygulanır. Haber ve hedge hataları birbirine karıştırılmaz. Yeni sunucu, anahtar veya
Cron işi gerekmez. GitHub schedule fallback olarak kalır; `queue: max` manuel
isteğin başka pending iş tarafından düşürülmesini azaltır.

Python borsa takvimi tatil/erken kapanışta belirleyicidir. Seans dışına geciken iş
son tamamlanan seansı hesaplayabilir; o durumda işlem bildirimi gönderilmez.
Mevcut ve sonraki seans açılış/kapanışları kaydedilir. Arayüz bu pencerelerden
mevcut piyasa durumunu ve takvim/veri gecikmesini ayırır. Beta, destek, kırılım,
koruma oranı veya emir davranışı değiştirilmedi.

## Doğrulama

| Kontrol | Sonuç |
| --- | --- |
| Sunucu/veritabanı testleri | 115/115 başarılı |
| Arayüz testleri | 73/73 başarılı |
| Python motor/lifecycle testleri | 15/15 başarılı |
| TypeScript | Başarılı |
| Üretim derlemesi | Başarılı |
| `git diff --check` | Boşluk hatası yok |

SQL migration PGlite üzerinde iki kez uygulanarak etkin işin korunması, sahiplik,
kısa hata beklemesi, beş dakikalık başarı beklemesi, otomatik backoff, eski işin
reddi ve başarılı analizin bildirim hatasından korunması test edildi. API/motor
testleri dış isteklere gerçek iş başlatmadan çalışır; Python verileri sentetiktir.
Takvim testleri yaz/kış saati, hafta sonu ve tatili kapsar. Arayüz testleri jsdom
kullanır; canlı yeni iş yukarıdaki kayıtta ayrıca doğrulandı, telefon testi yapılmadı. Gerçek hesapla hedge/finansal
emir verilmedi. Kullanıcıya ait mevcut dosyalar veya inceleme raporları silinmedi.

## Yayın sırası

1. `supabase/migrations/20261028_hedge_refresh_tracking.sql`
2. GitHub `main` kod yayını; Vercel'in Ready durumunu doğrulama
3. Portföy Kalkanı → Şimdi Analiz Et ile bir manuel istek
4. Yeni revizyon, run ID, `running → completed` ve yeni fiyat zamanı kontrolü

Ayrıntılar ve canlı sorgu `HEDGE_SHIELD_SETUP.md` içindedir. GitHub veya fiyat
sağlayıcısının arızası veya gecikmesi devam edebilir; yerel testler canlı başarı
garantisi olarak sunulmaz.

## Resmi kaynaklar

- Dispatch girdileri ve iş kimliği: https://docs.github.com/en/rest/actions/workflows?apiVersion=2026-03-10
- Concurrency kuyruğu: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
- Zamanlama gecikmesi: https://docs.github.com/en/actions/how-tos/troubleshoot-workflows

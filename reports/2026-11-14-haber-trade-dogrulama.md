# Haber ve Trade düzeltmeleri — 14 Kasım 2026

Önceki son kayıtlar `2dd173a` bulut desen taraması, `2887d34` düşüş istatistikleri
ve `761a4d9` hızlı haber geliştirmeleriydi. Bu işlevler korunarak normal haber ve
gün içi fiyat yolları düzeltildi.

Normal haberin yayında eksik `/api/news` yoluna bağımlılığı kaldırıldı. Mevcut
account fonksiyonundan doğrulanmış oturumla arşiv ve gerektiğinde doğrudan şirket
haberleri okunuyor. News to Trading aynı normal akışa kaynak makaleleri ekliyor;
kısa/uzun etki yorumları, tarihsel oynaklık senaryoları ve kullanıcı girdili risk
hesabı sunuyor. Hesaplama yöntemi ekranda ve `NEWS_TO_TRADING.md` içinde yazılı.

Trade API yalnız boş araştırma kartı oluşturduğu ve veriyi ayrı worker'a bıraktığı
için gün içi fiyat bekleme durumu kalıcıydı. Sayfa açıkken sınırlı bulut yenilemesi,
kalıcı deneme sırası ve gerçek quote/chart yedeği eklendi. Yahoo'nun normal seans
kapanışındaki sıfır hacimli son satırı mumdan ayrıldı. Lisanslı veriye ait canlı
kalite kapıları ve bildirim yetkileri korunuyor.

İki videonun içeriği indirilip kareler üzerinden incelendi. Strateji yorumları,
kaynaklar ve belirsiz parametreler `2026-11-14-video-stratejileri.md` raporundadır.
ATR teyit anında sabitlenir; sonradan oynaklık artışı eski stopu genişletmez. Eski
strateji teyitleri kayıttan okuma ve istemci saatinde yeniden denetlenir.

14 Kasım 2026, 14:10 İstanbul saatindeki salt okunur kaynak kontrolü:

| Kontrol | Sonuç |
|---|---|
| AAPL ve MSFT | Gerçek kaynak fiyatı, USD, son normal seanstan 390 mum ve üç araştırma hedefi |
| THYAO.IS | Gerçek kaynak fiyatı, TRY, son seanstan dakika verisi ve üç araştırma hedefi |
| AAPL normal haber | HTTP 200, beş kaynak makale |
| AAPL News to Trading | Beş tarihli kanıt, iki tarihsel fiyat bandı |
| Yarı iletken sektör sorgusu | Beş makale; sektöre tek hisse fiyatı veya pozisyon adedi atanmadı |
| Hafta sonu video teyitleri | Geçmiş desen korunuyor; güncel teyit yerine eski veri / bekleme durumu |

Kaynak kontrolünde üretim hesabına, üretim veritabanına veya bildirim teslimine
yazılmadı. Oturum/veritabanı entegrasyonu otomatik testlerde bağımsız fixture'larla
doğrulanır. Bu rapor canlı dağıtım ya da açık seans performans testi değildir.

Son doğrulama: `npm test` tek koşuda **213 sunucu/birim + 121 arayüz = 334 test**
başarılı. `npm run build`, `tsc -p tsconfig.hedge.json` ve `git diff --check`
başarılı. Vercel fonksiyon sayısı 12 olarak korundu. İlk doğrulama aşamasında
kod canlıya yayımlanmadı; canlı yayın bu kontrollerden sonraki ayrı aşamadır.

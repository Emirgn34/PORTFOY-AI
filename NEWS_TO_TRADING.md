# Normal haberler ve News to Trading

Normal haber akışı `/api/account?feature=news&action=feed` üzerinden çalışır.
Bu yönlendirme mevcut Vercel account fonksiyonunu paylaşır; yeni serverless
fonksiyon veya SQL migration gerektirmez. Oturum doğrulaması mevcut Supabase
sunucu bağlantısını kullanır. Tarayıcıya service role anahtarı gönderilmez.

Haber havuzu boş, eksik veya eski olduğunda şirket haberleri Yahoo ve Google
News kaynaklarından istek üzerine alınır. Genel akışın başlangıç örneklemi
AAPL, MSFT ve THYAO.IS'tir; portföy ve izleme listesindeki semboller dört
sembollük isteklerle ayrıca yüklenir. Yerel `/api/news` ve mevcut Supabase
arşivi bağlantı yedeği olarak korunur. Arayüz yükleme, boş kaynak ve yeniden
deneme durumlarını gösterir. Portföyün buluttan okunması genel akışı engellemez.

Normal haber sayfasındaki News to Trading alanı şirket/sektör veya hisse
sorgular. Haber kartının ayrıntısında aynı hissenin planı otomatik açılır.
Analizde alınan makaleler normal akışa eklenir. Kaynak bağlantıları, tarihler
ve başlıklar gösterilir; tarihsiz veya gelecekteki haberler işlem özetine
katılmaz. Başlık tonları ve olay kategorileri mevcut kural motoruyla işlenir;
tam metin okunmuş veya bağımsız teyit edilmiş gibi sunulmaz. Anthropic/API
model çağrısı yapılmaz.

Sayısal fiyat senaryosu en az 22 geçerli günlük kapanış gerektirir. En çok
60 düzeltilmiş log getirinin örnek standart sapması ile son kapanış
`exp(±sigma * sqrt(gün))` olarak 5 ve 63 işlem gününe taşınır. Oluşmakta olan
seans mumu, gelecek veri, 7 günden eski son kapanış, sıfır oynaklık ve kopuk
şirket işlemi verisiyle bant üretilmez. Bunlar tarihsel dalgalanma senaryolarıdır;
habere dayalı hedef veya olasılık tahmini değildir. Sektöre tek hisse fiyatı
atanmaz. Uzun vadeli nitel etkiler ayrıca 3–12 ay çerçevesinde gösterilir.

Risk hesabı kullanıcı sermayesi girilene kadar boyut üretmez. Örnek uzun
pozisyon; kayıp bütçesi, tahsis tavanı, giriş, zarar kes ve baz puan maliyetini
birlikte dikkate alır. Varsa başlangıç zarar kes örneği kapanış eksi 1,5 ATR14'tür;
kullanıcı değiştirebilir. Negatif veya karışık/nötr haber akışında yeni uzun
pozisyon için önerilen adet sıfırdır. Emir gönderilmez.

Kontroller:

```powershell
node --test test/newsTrading.test.js test/newsApi.test.js
node node_modules/vitest/vitest.mjs run src/components/NewsTradingPanel.test.jsx src/pages/NewsPage.test.jsx src/services/liveNews.test.jsx
```

Canlı ortamda Haberler > Tüm Haberler sayfasını açıp hisse seçin; kaynak,
yayımlanma tarihi, kısa/uzun etkiler, kapanış tarihi ve sermaye girildiğinde
risk/tahsis hesabını kontrol edin. Yarı iletkenler gibi bir sektör sorgusunda
hisse seçilmedikçe fiyat ve pozisyon rakamı oluşmamalı.

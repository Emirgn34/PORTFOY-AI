# 28 Ekim 2026 — portföy düzeni ve paylaşım görseli

## Yapılanlar

- Mevcut portföy tablosuna dnd-kit ile taşıma tutamacı eklendi. Telefonda 300 ms
  basılı tutma, fareyle sürükleme ve klavye desteği var. Parmağın ilk hareketi
  kaydırmaysa taşıma başlamaz; işlem yalnızca tutamaçtan başlatılır.
- Kişisel sıra mevcut `portfolios.stocks` JSON dizisinde korunur. Kolon başlığıyla
  sıralama bunu değiştirmez; `Kişisel sıra` düğmesi bu düzene döner. Taşıma, güncel
  kayıtları kimlikleriyle yeniden dizer; fiyat, adet ve diğer alanlar korunur.
- Taşıma bittiğinde kayıt hemen başlatılır. Ardışık kayıtlar sırayla yazılır ve
  sayfa hemen yeniden açılırsa önceki kaydın bitmesi beklenir. Kayıt sonucu ve
  yeniden deneme seçeneği ekranda görünür. Hesap değişiminde yazma hedefi eski
  düzenlemenin sahibi olarak kalır; yeni hesabın kimliğiyle eski veri yazılmaz.
- Mevcut senkronizasyon hook'unda okuma hatasının boş portföy sayılması giderildi.
  Portföy sayfası okuma hatasında düzenleyiciyi açmaz ve yeniden okuma sunar.
  Kayıt bulunmadığında salt okuma sırasında boş bir satır yazılmaz.
- Dağılım kartında sağa kaydırma ve erişilebilir düğme ile paylaşım görünümü açılır;
  sola kaydırma normal dağılıma döner. Dikey kaydırma görünümü değiştirmez.
- PNG, koyu/turkuaz SVG tasarımından tarayıcıda oluşturulur. Standart boyut
  1080 × 1350; uzun listelerde hiçbir hisse düşürülmeden yükseklik artırılır.
  Aynı hisse kodunun payları birleştirilir; tek ondalık yuvarlama toplamı %100'dür.
- Görsel üretimine sadece `{label, percent}` aktarılır. Tutar, fiyat, adet,
  hesap ve not alanları projeksiyondan çıkarılır. SVG metni XML için kaçışlanır.
  Sayfanın ekran görüntüsü alınmaz; harici görsel servisine veri gönderilmez.
- PNG indirme düğmesi ve destek varsa dosya paylaşım menüsü vardır. PNG menüye
  basılmadan önce hazırlanır; kullanıcı paylaşımı iptal ederse indirme başlamaz.
  Geçici görsel URL'leri bileşen kapanınca temizlenir.

## Doğrulama

- `npm.cmd run test:unit`: 118 test başarılı.
- `npm.cmd run test:ui`: 89 test başarılı.
- `node node_modules/typescript/bin/tsc -p tsconfig.hedge.json`: başarılı.
- Hedge Python testleri: 15 test başarılı.
- `npm.cmd run build`: başarılı.
- Örnek sekiz hisseli SVG geçici resvg aracıyla 1080 × 1350 PNG'ye çizildi ve
  görsel olarak incelendi. Başlık, halka ve sekiz etiket okunaklı; tutar yok.
  Örnek dosyalar `.tmp/portfolio-share-preview.svg` ve `.tmp/portfolio-share-preview.png`.
- Kayıt hatası/yeniden deneme, hesap değişimi, sayfayı hemen kapatma/açma,
  kolon sıralamasından kişisel sıraya dönme, uzun basma öncesi kaydırma iptali,
  paylaşım iptali, sağa/sola/dikey kaydırma ve görsel mahremiyeti testlerle doğrulandı.

## Canlı kontrol ve sınırlar

Bu rapor kodun yayımlandığı veya telefonda doğrulandığı anlamına gelmez.
Yerel tarayıcı kontrolünde Computer Use pencere erişimi zaman aşımına uğradı;
bağlı tarayıcı adaptörü de mevcut değildi. SVG dosya çıktısı ayrı incelendi,
ancak gerçek tarayıcıdaki canvas/PNG, yerel paylaşım menüsü ve fiziksel dokunma
hareketi yayın sonrası test edilmelidir.

Yeni SQL veya ortam değişkeni gerekmez. Yayın sonrası bir hisse taşınıp kayıt
mesajı beklenir; sayfa ve başka cihazdaki aynı hesap yeniden açılır. Dağılım kartı
sağa kaydırılır, PNG indirilir ve yalnızca hisse kodları/yüzdeler olduğu incelenir.
Paylaşım destekleniyorsa kullanıcı istediği uygulamayı kendisi seçer.

İki farklı cihaz aynı portföyü eşzamanlı düzenlerse mevcut tüm-JSON kayıt modeli
gereği son kayıt geçerlidir. Çevrimdışı kalıcı bir düzenleme kuyruğu eklenmedi;
kayıt hatasında sayfadan çıkmadan tekrar denemek gerekir.

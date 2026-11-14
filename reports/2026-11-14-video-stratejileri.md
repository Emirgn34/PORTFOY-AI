# Paylaşılan iki videonun incelemesi — 14 Kasım 2026

İki gönderinin video içeriği indirildi ve zaman aralıklı kareler incelendi. Gönderi kimlikleri ve video adresleri herkese açık gönderi metadatasıyla eşleştirildi. Kaynaklar:

- [Natu: 12 Kasım 2026](https://x.com/nanaT3__7717/status/2120810656308113711). Yaklaşık 23 saniye. Video kimliği `2120810605049528320`.
- [Aya: 12 Kasım 2026](https://x.com/mzgaangy/status/2120806522259440007). Yaklaşık 34 saniye. Video kimliği `2120806483671822336`.

İnceleme kareleri yerel `.tmp/strategy-natu-contact.png`, `.tmp/strategy-aya-contact.png`; asıl videolar aynı dizindeki `strategy-natu.mp4` ve `strategy-aya.mp4` dosyalarındadır. Bu geçici dosyalar Git kapsamı dışındadır. Uygulama videolara veya bu geçici dosyalara çalışma zamanında bağımlı değildir.

## Birinci video

Görülen yapı yükselen paralel kanal, önceki tepenin kırılmasıyla işaretlenen CHoCH, dipten yeni tepeye Fibonacci ölçümü ve %50–61,8 geri çekilme bölgesinde alıştır. Sonraki karelerde zarar kes bu giriş bölgesinin altına, hedef de yeni tepenin üstündeki Fibonacci projeksiyonuna çizilir. Grafikte sayısal fiyat, sembol veya zaman dilimi gösterilmez.

Uygulama, önceki tepe üzerinde **kapanış** arar; yalnızca fitil yeterli değildir. İki sol ve iki sağ kapanmış mumla teyitli tepe → dip → daha yüksek tepe dizisinden kanal kurar. Giriş bölgesi impuls tepesinden %50–61,8 geri çekilmedir. Hedef, impuls tepesinin yarım impuls üstüdür. Zarar kes, giriş bölgesinin 0,25 ATR altıdır. ATR, impuls tepesinin teyit anındaki 14 mumdan hesaplanıp aynı yapı için sabitlenir; sonradan artan oynaklık eski zarar kes seviyesini uzaklaştıramaz. Son iki mumdan birinde bölge teması ve son kapanmış mumda yükseliş dönüşü, geometrik teyit sayılır. Bu kapanış, pivot ve ATR tercihleri videoda verilmemiş uygulama varsayımlarıdır.

Zarar kes veya hedef görüldükten sonra eski kurulum yeniden kullanılmaz. Kanal dışındaki kapanış da kurulumu geçersizleştirir.

## İkinci video

Görülen yapı, paralel kanalla birlikte dönüşümlü dip ve tepeler, eğik bir 0,786 işareti, alt sınırda alış ve üst sınırda satış yönlü örnektir. Videoda 0,786 işaretinin hangi noktalardan ve hangi dönüşümle ölçüldüğünü açıklayan formül bulunmaz. Bu nedenle görüntüden kesin bir harmonik formasyon adı veya sıradan yatay Fibonacci fiyatı çıkarmak doğru değildir.

Uygulama iki teyitli yükselen dipten alt paraleli, aradaki tepeden kanal genişliğini kurar. Alt kanal çevresindeki 0,25 ATR bölgesi alış senaryosudur. Kanal yüksekliğinin %78,6–100 bölgesi satış senaryosudur. Zarar kes ilgili kanal sınırının 1 ATR dışındadır; hedef karşı kanalın 0,25 ATR içidir. ATR ikinci dip teyit anında sabitlenir. Teyit sonrasında gözlenen kanal risk sınırı ihlali, fiyat tekrar kanal içine dönse de aynı çapaları geçersiz tutar. Bu, videonun kanal dönüşü fikrinin **açıkça etiketlenmiş bir yorumudur**; videodaki belirsiz 0,786 ölçümünün birebir uygulaması olduğu iddia edilmez.

İkinci gönderinin alıntıladığı ayrıca bir EMA200/RSI14 makalesi vardır. Kullanıcının işaret ettiği videoda anlatılan kanal geometrisi yerine bu farklı makale stratejisi kullanılmadı.

## Veri ve doğrulama

Her iki yorum da `server/videoStrategies.js` içindedir ve yalnızca kapanmış bir dakikalık mumları kullanır. Gelecekteki ve açık mumlar değerlendirmeye girmez. En az 30 kesintisiz mum gerekir; gece boşlukları veya eksik mumlar birleştirilmez. Negatif/bozuk OHLC, yinelenen zaman ve hizasız mumlar kabul edilmez. Son kapanmış mum beş dakikadan eskiyse güncel teyit kaldırılır ve geçmiş geometri yalnızca araştırma bağlamı olarak kalır.

Strateji sonuçları daima `actionable: false` ve `dataMode: research` döndürür. Mum teyidi, gerçek zamanlı işlem izni anlamına gelmez. Gerçek zamanlı kaynak, seans, maliyet, makro olay ve bildirim kapıları mevcut Trade motorunda ayrıca uygulanır. Brüt getiri/risk oranı başarı olasılığı değildir. Videodaki performans iddiaları uygulamaya taşınmadı.

`node --test test/videoStrategies.test.js`: **10 test geçti**. Testler kaynak ve yetersiz veri durumunu, CHoCH + geri çekilmeyi, fitil kaynaklı yanlış kırılmayı, iki kanal yönünü, düşen/yatay geometriyi, açık/gelecek mumların etkisizliğini, zarar kes ihlalini, eski veriyi ve bozuk/kesintili veri akışını kapsar. Ek testler aynı yapı için sonradan artan oynaklığın eski zarar kes seviyesini uzaklaştıramadığını ve kanal ihlalinden sonra eski çapaların yeniden etkinleşmediğini doğrular.

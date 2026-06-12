/**
 * Mock haber verisi.
 * İleride gerçek haber kaynakları (KAP, finans siteleri, haber API'leri)
 * bağlandığında bu dosya yerine bir servis katmanı (ör. src/services/newsService.js)
 * aynı veri şemasını döndürecek şekilde kullanılacaktır.
 */
export const NEWS_TYPES = ['Anlaşma', 'Bilanço', 'Yatırım', 'Ortaklık', 'KAP', 'Genel Haber'];

export const MOCK_NEWS = [
  {
    id: 'n1',
    ticker: 'THYAO',
    company: 'Türk Hava Yolları',
    title: 'THY, 40 yeni geniş gövde uçak siparişi için anlaşma imzaladı',
    summary:
      'Türk Hava Yolları, filo genişletme planı kapsamında 40 adet geniş gövde uçak alımı için üretici firmayla kesin anlaşmaya vardığını duyurdu.',
    content:
      'Türk Hava Yolları, 2033 filo hedefleri doğrultusunda 40 adet geniş gövde uçak siparişi için üretici firmayla kesin anlaşma imzaladığını KAP üzerinden açıkladı. Teslimatların 2028-2032 yılları arasında kademeli olarak yapılması planlanıyor. Şirket yönetimi, yeni uçakların uzun menzilli hatlarda kapasite artışı sağlayacağını ve birim maliyetleri düşüreceğini belirtti. Anlaşmanın finansmanının operasyonel nakit akışı ve uzun vadeli kiralama kombinasyonuyla karşılanması bekleniyor.',
    type: 'Anlaşma',
    date: '2026-06-09',
    source: 'KAP Bildirimi',
    sentiment: 'positive',
    reliability: 9,
    reliabilityReason:
      'Haber doğrudan KAP bildirimine dayanıyor ve şirketin resmi açıklamasıyla birebir örtüşüyor. Birden fazla büyük finans haber kaynağı tarafından da teyit edildi.',
    sentimentExplanation:
      'Filo büyümesi uzun vadeli kapasite ve gelir artışı anlamına geliyor; finansman yapısının dengeli olması bilanço riskini sınırlıyor. Bu nedenle pozitif olarak değerlendirildi.',
    confirmedSources: ['KAP', 'Bloomberg HT', 'Reuters'],
  },
  {
    id: 'n2',
    ticker: 'ASELS',
    company: 'Aselsan',
    title: 'Aselsan ilk çeyrek net karını %62 artırdı',
    summary:
      'Aselsan, 2026 ilk çeyrek bilançosunda net karını geçen yılın aynı dönemine göre %62 artırarak beklentilerin üzerinde sonuç açıkladı.',
    content:
      'Aselsan 2026 yılı ilk çeyrek finansal sonuçlarını açıkladı. Net kar yıllık bazda %62 artarken, ciro %48 yükseldi. Bakiye sipariş tutarı 14 milyar doları aşarak rekor seviyeye ulaştı. Şirket, ihracat gelirlerinin toplam ciro içindeki payının artmaya devam ettiğini ve yıl sonu hedeflerini yukarı yönlü revize ettiğini bildirdi. Analistler, marjlardaki iyileşmenin sürdürülebilirliğine dikkat çekiyor.',
    type: 'Bilanço',
    date: '2026-06-07',
    source: 'Bloomberg HT',
    sentiment: 'positive',
    reliability: 8,
    reliabilityReason:
      'Finansal sonuçlar KAP üzerinden resmi olarak açıklandı; haber metnindeki rakamlar bilançoyla uyumlu. Yorum kısmı analist görüşü içerdiği için tam puan verilmedi.',
    sentimentExplanation:
      'Kar ve ciro büyümesi beklentilerin üzerinde, bakiye siparişler rekor seviyede. Operasyonel görünüm güçlü olduğu için pozitif değerlendirildi.',
    confirmedSources: ['KAP', 'Bloomberg HT', 'Dünya Gazetesi'],
  },
  {
    id: 'n3',
    ticker: 'SISE',
    company: 'Şişecam',
    title: 'Şişecam Avrupa operasyonlarında kapasite azaltımına gidiyor',
    summary:
      'Şişecam, Avrupa düzcam pazarındaki zayıf talep nedeniyle iki üretim hattında geçici kapasite azaltımı kararı aldı.',
    content:
      'Şişecam, Avrupa düzcam pazarında devam eden talep zayıflığı ve artan enerji maliyetleri nedeniyle Bulgaristan ve İtalya operasyonlarında iki üretim hattında geçici kapasite azaltımına gideceğini duyurdu. Şirket, kararın yıllık üretim kapasitesinin yaklaşık %6\'sına denk geldiğini ve talep koşulları normalleştiğinde hatların yeniden devreye alınacağını belirtti. Analistler kısa vadede marj baskısının süreceği görüşünde.',
    type: 'KAP',
    date: '2026-06-05',
    source: 'KAP Bildirimi',
    sentiment: 'negative',
    reliability: 8,
    reliabilityReason:
      'Karar şirketin resmi KAP açıklamasına dayanıyor. Kapasite oranı ve lokasyon bilgileri açıklama ile birebir uyumlu.',
    sentimentExplanation:
      'Kapasite azaltımı kısa vadede ciro ve marj kaybı anlamına geliyor; Avrupa talebindeki zayıflık sürdüğü için negatif değerlendirildi.',
    confirmedSources: ['KAP', 'Ekonomim'],
  },
  {
    id: 'n4',
    ticker: 'AAPL',
    company: 'Apple Inc.',
    title: 'Apple, yapay zeka destekli Siri yenilemesini sonbahara erteledi',
    summary:
      'Apple\'ın yeni nesil yapay zeka asistanının çıkışını bir kez daha ertelediği, lansmanın sonbahar etkinliğine kaydığı iddia edildi.',
    content:
      'Teknoloji basınında yer alan haberlere göre Apple, yeni nesil yapay zeka destekli Siri sürümünün lansmanını bir kez daha erteledi. Şirkete yakın kaynaklar, kalite sorunları nedeniyle çıkışın sonbahar donanım etkinliğine kaydırıldığını öne sürüyor. Apple cephesinden konuya ilişkin resmi bir açıklama gelmedi. Analistler, gecikmenin hizmet gelirleri üzerindeki etkisinin sınırlı olacağını ancak rekabet açısından algı riski yarattığını belirtiyor.',
    type: 'Genel Haber',
    date: '2026-06-08',
    source: 'TechCrunch (çeviri)',
    sentiment: 'negative',
    reliability: 5,
    reliabilityReason:
      'Haber isimsiz kaynaklara dayanıyor ve şirketten resmi doğrulama yok. Benzer iddialar birden fazla teknoloji sitesinde yer alsa da teyit zinciri zayıf.',
    sentimentExplanation:
      'Ürün gecikmesi rekabet gücü algısını zayıflatabilir; ancak finansal etki belirsiz olduğu için hafif negatif olarak işaretlendi.',
    confirmedSources: ['TechCrunch', 'The Verge'],
  },
  {
    id: 'n5',
    ticker: 'MSFT',
    company: 'Microsoft',
    title: 'Microsoft, Avrupa\'da 12 milyar dolarlık yeni veri merkezi yatırımı açıkladı',
    summary:
      'Microsoft, artan yapay zeka talebini karşılamak için Avrupa genelinde 12 milyar dolarlık veri merkezi yatırım programı başlattı.',
    content:
      'Microsoft, önümüzdeki üç yıl içinde Avrupa genelinde 12 milyar dolarlık veri merkezi yatırımı yapacağını resmi blogundan duyurdu. Yatırım; Almanya, İspanya ve Polonya\'da yeni bölgelerin açılmasını ve mevcut kapasitenin genişletilmesini kapsıyor. Şirket, Azure ve yapay zeka hizmetlerine yönelik kurumsal talebin kapasiteyi aştığını belirtti. Yatırımın 2029 itibarıyla tam kapasiteye ulaşması bekleniyor.',
    type: 'Yatırım',
    date: '2026-06-10',
    source: 'Microsoft Resmi Blog',
    sentiment: 'positive',
    reliability: 9,
    reliabilityReason:
      'Açıklama doğrudan şirketin resmi blogundan yapıldı ve uluslararası haber ajansları tarafından doğrulandı.',
    sentimentExplanation:
      'Veri merkezi yatırımı, bulut ve yapay zeka gelir büyümesinin devam edeceğine işaret ediyor; uzun vadeli büyüme hikayesini desteklediği için pozitif.',
    confirmedSources: ['Microsoft Blog', 'Reuters', 'CNBC'],
  },
  {
    id: 'n6',
    ticker: 'THYAO',
    company: 'Türk Hava Yolları',
    title: 'THY kargo iştiraki için stratejik ortaklık görüşmeleri yürütüyor iddiası',
    summary:
      'Basında çıkan haberlere göre THY, kargo iştiraki için küresel bir lojistik şirketiyle ortaklık görüşmeleri yürütüyor.',
    content:
      'Bazı ekonomi haber sitelerinde yer alan iddialara göre Türk Hava Yolları, kargo iştirakinin büyümesini hızlandırmak amacıyla küresel bir lojistik devi ile stratejik ortaklık görüşmeleri yürütüyor. Şirketten yapılan kısa açıklamada "çeşitli stratejik alternatiflerin her zaman değerlendirildiği" ifade edildi ancak somut bir görüşme doğrulanmadı. Görüşmelerin hangi aşamada olduğu bilinmiyor.',
    type: 'Ortaklık',
    date: '2026-06-04',
    source: 'Ekonomi Haber Siteleri',
    sentiment: 'neutral',
    reliability: 4,
    reliabilityReason:
      'İddia tek bir kaynaktan çıktı ve şirket somut doğrulama yapmadı. "Stratejik alternatifler" açıklaması teyit niteliği taşımıyor.',
    sentimentExplanation:
      'Ortaklık gerçekleşirse pozitif olabilir ancak doğrulanmamış bir iddia olduğu için nötr olarak değerlendirildi.',
    confirmedSources: ['Ekonomim'],
  },
  {
    id: 'n7',
    ticker: 'ASELS',
    company: 'Aselsan',
    title: 'Aselsan\'dan 280 milyon dolarlık yeni ihracat sözleşmesi',
    summary:
      'Aselsan, uluslararası bir müşteriyle 280 milyon dolar tutarında savunma sistemleri ihracat sözleşmesi imzaladı.',
    content:
      'Aselsan, uluslararası bir müşterisiyle hava savunma sistemleri alanında toplam 280 milyon dolar tutarında ihracat sözleşmesi imzaladığını KAP\'a bildirdi. Teslimatların 2027-2029 yılları arasında gerçekleştirilmesi planlanıyor. Bu sözleşmeyle birlikte şirketin yıl başından bu yana açıkladığı toplam ihracat sözleşmesi tutarı 1,1 milyar doları aştı.',
    type: 'Anlaşma',
    date: '2026-06-02',
    source: 'KAP Bildirimi',
    sentiment: 'positive',
    reliability: 10,
    reliabilityReason:
      'Sözleşme tutarı ve takvimi resmi KAP bildiriminde açıkça yer alıyor; haber metni bildirimle birebir aynı bilgileri içeriyor.',
    sentimentExplanation:
      'Yeni ihracat sözleşmesi hem ciro görünürlüğünü hem de döviz bazlı gelir payını artırıyor; net pozitif.',
    confirmedSources: ['KAP', 'Anadolu Ajansı', 'Bloomberg HT'],
  },
  {
    id: 'n8',
    ticker: 'AAPL',
    company: 'Apple Inc.',
    title: 'Apple hizmet gelirlerinde yeni rekor bekleniyor',
    summary:
      'Analistler, Apple\'ın bu çeyrekte hizmet segmentinde tüm zamanların en yüksek gelirini açıklamasını bekliyor.',
    content:
      'Wall Street analistlerinin konsensüs tahminlerine göre Apple, açıklanacak çeyrek sonuçlarında hizmet segmentinde 27 milyar doların üzerinde gelirle yeni bir rekor kırabilir. App Store, iCloud ve abonelik hizmetlerindeki büyümenin sürdüğü tahmin ediliyor. Donanım tarafında ise iPhone satışlarının yatay seyretmesi bekleniyor. Resmi sonuçlar ay sonunda açıklanacak.',
    type: 'Genel Haber',
    date: '2026-06-06',
    source: 'CNBC (çeviri)',
    sentiment: 'neutral',
    reliability: 6,
    reliabilityReason:
      'Haber analist tahminlerine dayanıyor; henüz açıklanmış resmi bir veri yok. Tahminler saygın kurumlardan geldiği için orta-üstü puan verildi.',
    sentimentExplanation:
      'Hizmet büyümesi olumlu ancak donanım tarafının yatay seyri bekleniyor; net etki dengelendiği için nötr.',
    confirmedSources: ['CNBC', 'MarketWatch'],
  },
  {
    id: 'n9',
    ticker: 'SISE',
    company: 'Şişecam',
    title: 'Şişecam cam ambalajda geri dönüşüm yatırımını devreye aldı',
    summary:
      'Şişecam, Eskişehir tesisinde yıllık 120 bin ton kapasiteli cam geri dönüşüm hattını devreye aldığını açıkladı.',
    content:
      'Şişecam, sürdürülebilirlik stratejisi kapsamında Eskişehir tesisinde yıllık 120 bin ton işleme kapasitesine sahip cam geri dönüşüm hattını devreye aldı. Yatırımın enerji maliyetlerini düşürmesi ve karbon ayak izini azaltması bekleniyor. Şirket, geri dönüştürülmüş cam oranını 2030\'a kadar %35\'in üzerine çıkarma hedefini yineledi.',
    type: 'Yatırım',
    date: '2026-05-28',
    source: 'Şirket Açıklaması',
    sentiment: 'positive',
    reliability: 7,
    reliabilityReason:
      'Açıklama şirketin kendi basın bülteninden geliyor; bağımsız kaynak teyidi sınırlı ancak bilgi doğrulanabilir nitelikte.',
    sentimentExplanation:
      'Maliyet düşürücü ve sürdürülebilirlik odaklı yatırım uzun vadede marjları destekler; pozitif değerlendirildi.',
    confirmedSources: ['Şirket Basın Bülteni', 'Dünya Gazetesi'],
  },
  {
    id: 'n10',
    ticker: 'MSFT',
    company: 'Microsoft',
    title: 'AB, Microsoft\'un bulut lisanslama uygulamalarına yeni inceleme başlattı',
    summary:
      'Avrupa Komisyonu, Microsoft\'un kurumsal bulut lisanslama koşullarına ilişkin yeni bir ön inceleme başlattı.',
    content:
      'Avrupa Komisyonu, Microsoft\'un kurumsal müşterilere yönelik bulut lisanslama koşullarının rekabeti kısıtlayıp kısıtlamadığına ilişkin yeni bir ön inceleme başlattığını duyurdu. İnceleme, rakip bulut sağlayıcıların şikayetleri üzerine açıldı. Microsoft, düzenleyicilerle yapıcı şekilde çalışmaya devam ettiğini açıkladı. Sürecin resmi soruşturmaya dönüşüp dönüşmeyeceği önümüzdeki aylarda netleşecek.',
    type: 'Genel Haber',
    date: '2026-06-03',
    source: 'Reuters (çeviri)',
    sentiment: 'negative',
    reliability: 8,
    reliabilityReason:
      'İnceleme Avrupa Komisyonu\'nun resmi duyurusuna dayanıyor ve birden fazla uluslararası ajans tarafından doğrulandı.',
    sentimentExplanation:
      'Düzenleyici incelemeler ceza ve iş modeli değişikliği riski taşır; henüz erken aşamada olsa da negatif olarak işaretlendi.',
    confirmedSources: ['Reuters', 'Financial Times', 'AB Komisyonu'],
  },
  {
    id: 'n11',
    ticker: 'THYAO',
    company: 'Türk Hava Yolları',
    title: 'Mayıs ayı yolcu trafiği yıllık %9 arttı',
    summary:
      'THY\'nin mayıs ayı trafik sonuçlarına göre taşınan yolcu sayısı yıllık bazda %9, doluluk oranı 1,8 puan arttı.',
    content:
      'Türk Hava Yolları mayıs ayı trafik sonuçlarını açıkladı. Taşınan yolcu sayısı geçen yılın aynı ayına göre %9 artarken, yolcu doluluk oranı 1,8 puan iyileşerek %83,4 oldu. Dış hat yolcu sayısındaki artış %11 ile öne çıktı. Kargo tarafında taşınan ton miktarı %14 yükseldi. Veriler şirketin aylık olağan trafik bildirimi kapsamında KAP\'a iletildi.',
    type: 'KAP',
    date: '2026-06-06',
    source: 'KAP Bildirimi',
    sentiment: 'positive',
    reliability: 10,
    reliabilityReason:
      'Aylık trafik verileri şirketin resmi KAP bildirimi; rakamlar doğrudan birincil kaynaktan alındı.',
    sentimentExplanation:
      'Yolcu ve kargo büyümesi ile doluluk artışı operasyonel momentumun sürdüğünü gösteriyor; pozitif.',
    confirmedSources: ['KAP', 'Anadolu Ajansı'],
  },
  {
    id: 'n12',
    ticker: 'ASELS',
    company: 'Aselsan',
    title: 'Savunma hisselerinde kar realizasyonu baskısı',
    summary:
      'Yüksek prim yapan savunma hisselerinde kısa vadeli kar realizasyonu görülebileceği yorumları öne çıkıyor.',
    content:
      'Bazı aracı kurum strateji raporlarında, yıl başından bu yana endeksin belirgin üzerinde getiri sağlayan savunma hisselerinde kısa vadeli kar realizasyonu görülebileceği değerlendirmesi yapıldı. Raporlarda sektörün uzun vadeli görünümünün korunduğu ancak çarpanların tarihsel ortalamaların üzerine çıktığı belirtiliyor. Bu tür değerlendirmeler yatırım tavsiyesi niteliği taşımıyor.',
    type: 'Genel Haber',
    date: '2026-06-01',
    source: 'Aracı Kurum Raporları',
    sentiment: 'neutral',
    reliability: 5,
    reliabilityReason:
      'Haber, görüş niteliğindeki strateji raporlarına dayanıyor; doğrulanabilir somut bir olay içermiyor.',
    sentimentExplanation:
      'Kısa vadeli baskı ihtimali ile korunan uzun vadeli görünüm birbirini dengelediği için nötr.',
    confirmedSources: ['Aracı Kurum Strateji Raporları'],
  },
];

/**
 * Site eğitimi (onboarding turu) adımları.
 *
 * Her adım: hangi sayfada (route), hangi öğeyi vurgulayacağı (target =
 * [data-tour="..."]), başlık + açıklama, yerleşim ve gerekiyorsa bir eylem
 * (action) içerir. 'openModal' adımları "Hisse Ekle" formunu otomatik açar;
 * diğerleri formu kapalı tutar. Orkestratör (TourProvider) bu listeyi sırayla
 * gezer, sayfalar arası geçişi ve form açma/kaydırmayı kendisi yönetir.
 *
 * adminOnly: yalnızca yönetici turunda gösterilir.
 */
export const TOUR_STEPS = [
  {
    route: '/portfolio',
    target: 'body',
    placement: 'center',
    title: "PortföyAI'a hoş geldin 👋",
    content:
      "Kısa bir turla tüm önemli özellikleri tek tek göstereceğim. İlerlemek için “Anladım”a bas; istediğin an “Geç” ile çıkabilirsin.",
  },
  {
    route: '/portfolio',
    target: '[data-tour="sidebar-nav"]',
    placement: 'right',
    title: 'Ana menü',
    content:
      'Soldaki menüden 5 bölüme ulaşırsın: Portföyüm, İzleme Listesi, Haberler, Fırsatlar ve Portföy Yorumu.',
  },
  {
    route: '/portfolio',
    target: '[data-tour="portfolio-summary"]',
    title: 'Portföy özeti',
    content:
      'Toplam değer, maliyet, kâr/zarar ve hisse sayını tek bakışta burada görürsün. Fiyatlar canlı veriyle güncellenir.',
  },
  {
    route: '/portfolio',
    target: '[data-tour="add-stock"]',
    title: 'Hisse ekle',
    content:
      'Portföyüne yeni hisse eklemek için buraya basarsın. Hadi formu açıp işini kolaylaştıran özellikleri gösterelim.',
  },
  {
    route: '/portfolio',
    target: '[data-tour="stock-search"]',
    action: 'openModal',
    placement: 'bottom',
    title: 'Otomatik arama',
    content:
      'Hisse kodunu yazıp listeden seç — şirket adı, sektör ve güncel fiyat otomatik dolar.',
  },
  {
    route: '/portfolio',
    target: '[data-tour="amount-converter"]',
    action: 'openModal',
    placement: 'bottom',
    title: 'Tutar ⇄ Adet',
    content:
      "Kaç adet aldığını bilmiyor musun? “Tutar gir”e basıp yatırdığın parayı yaz; adet otomatik hesaplanır.",
  },
  {
    route: '/portfolio',
    target: '[data-tour="tranche-calculator"]',
    action: 'openModalAdvanced',
    placement: 'top',
    title: 'Kademeli alım',
    content:
      'Farklı fiyatlardan aldıysan bu bölümü aç; her kademeyi gir, toplam adet ve ağırlıklı ortalama maliyet otomatik hesaplanır.',
  },
  {
    route: '/portfolio',
    target: '[data-tour="live-price"]',
    title: 'Canlı fiyat',
    content: 'Fiyatları anlık veriyle güncellemek için buraya basabilirsin.',
  },
  {
    route: '/portfolio',
    target: '[data-tour="portfolio-table"]',
    title: 'Hisse tablosu',
    content:
      'Tüm hisselerin burada. Sütun başlıklarına tıklayarak sıralar, satırdan düzenler veya silersin.',
  },
  {
    route: '/watchlist',
    target: '[data-tour="watchlist-add"]',
    title: 'İzleme listesi',
    content:
      'Henüz almadığın ama takip ettiğin hisseleri buraya ekler, hedef fiyat belirlersin.',
  },
  {
    route: '/watchlist',
    target: '[data-tour="watchlist-list"]',
    title: 'Sırala & portföye taşı',
    content:
      'Kartları sürükleyerek sıralar, beğendiğin hisseyi tek tıkla portföyüne taşırsın. Kısa/uzun vade sekmeleriyle ayırırsın.',
  },
  {
    route: '/news',
    target: '[data-tour="news-filters"]',
    title: 'Haberler',
    content:
      'Portföy ve izleme listendeki hisselerin haberleri otomatik gelir. Kapsamı buradan seçersin; her haber AI ile duygu ve güvenilirlik açısından değerlendirilir.',
  },
  {
    route: '/opportunities',
    target: '[data-tour="opp-tabs"]',
    title: 'Fırsatlar',
    content:
      'Kısa ve uzun vade için skorlanmış fırsat adayları. Skor; haber, teknik, temel ve risk verisinden üretilir. Filtreleyip bir karta tıklayınca detaylı gerekçe açılır.',
  },
  {
    route: '/analysis',
    target: '[data-tour="analysis-score"]',
    title: 'Portföy Yorumu',
    content: 'Portföyünün genel skoru, risk seviyesi ve dağılımı burada özetlenir.',
  },
  {
    route: '/admin',
    target: '[data-tour="admin-panel"]',
    adminOnly: true,
    title: 'Kullanıcı Yönetimi',
    content:
      'Yönetici olarak buradan yeni kullanıcı oluşturur, listeler ve gerekirse silersin.',
  },
  {
    route: '/portfolio',
    target: '[data-tour="help-button"]',
    placement: 'bottom',
    title: 'Turu tekrar gör',
    content:
      'İstediğin an sağ üstteki 💡 ampul ikonuna basarak bu eğitimi yeniden başlatabilirsin.',
  },
  {
    route: '/portfolio',
    target: 'body',
    placement: 'center',
    title: 'Hazırsın! 🚀',
    content: "Artık PortföyAI'ı kullanmaya hazırsın. Bol kazançlar!",
  },
];

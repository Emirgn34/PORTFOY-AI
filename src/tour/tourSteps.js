// Hedefler veri olmayan hesaplarda da bulunan bölümlere bağlanır.
// action, hedef sayfa geç yüklense bile context üzerinden uygulanır.
export const TOUR_STEPS = [
  {
    route: '/portfolio', target: '[data-tour="portfolio-summary"]', centered: true,
    title: "PortföyAI'a hoş geldin",
    content: 'Portföy takibi, fırsatlar, hazır portföyler ve araştırma araçlarını birlikte gezelim. Devam ve Geri ile ilerleyebilir, Turu bitir ile istediğin an çıkabilirsin. Bu tur hiçbir hisse kaydetmez ve analiz başlatmaz.',
  },
  {
    route: '/portfolio', target: '[data-tour="sidebar-nav"]', global: true, action: 'openSidebar',
    title: 'Tüm bölümler tek menüde',
    content: 'Portföy Özeti, Fırsatlar, Hazır Portföyler, Portföy Analizi, Araştırma Merkezi, Haberler ve Takip Listesi burada. Mobilde sol üstteki menü düğmesiyle bu paneli açabilirsin.',
  },
  {
    route: '/portfolio', target: '[data-tour="theme-toggle"]', global: true, action: 'openSidebar',
    title: 'Açık ve karanlık tema',
    content: 'Sol alttaki düğme ile temayı değiştirebilirsin. Seçimin bu tarayıcıda saklanır ve sayfayı yeniden açtığında korunur.',
  },
  {
    route: '/portfolio', target: '[data-tour="portfolio-summary"]',
    title: 'Değer, maliyet ve getiri',
    content: 'Toplam portföy değerini, yatırdığın tutarı ve kâr/zararını burada izle. Getiri kartındaki dönem seçimiyle farklı zaman aralıklarını karşılaştır; veri bulunmayan dönemlerde gösterilen açıklamayı kontrol et.',
  },
  {
    route: '/portfolio', target: '[data-tour="add-stock"]',
    title: 'Portföyüne hisse ekle',
    content: 'Hisse Ekle ile alımlarını kaydet; adet, ortalama alış fiyatı, para birimi ve notlarını gir. Şimdi kayıt yapmadan formdaki yardımcı araçları inceleyelim.',
  },
  {
    route: '/portfolio', target: '[data-tour="stock-search"]', action: 'openModal',
    title: 'Hisse arama',
    content: 'Hisse kodunu yazıp arama sonucundan seçebilirsin. Veri mevcutsa şirket, piyasa, para birimi ve fiyat bilgileri doldurulur. Kaydetmeden önce bilgileri kontrol et.',
  },
  {
    route: '/portfolio', target: '[data-tour="amount-converter"]', action: 'openModal',
    title: 'Adet yerine tutar gir',
    content: 'Tutar gir seçeneği, yatırdığın para ve alış fiyatından adedi hesaplar. Elinde adet bilgisi varsa doğrudan adet girişi de yapabilirsin.',
  },
  {
    route: '/portfolio', target: '[data-tour="tranche-calculator"]', action: 'openModalAdvanced',
    title: 'Kademeli alım hesabı',
    content: 'Farklı fiyatlardan yaptığın alımları ayrı satırlara gir. Hesaplanan toplam adet ve ağırlıklı ortalama alış fiyatını forma aktarabilirsin.',
  },
  {
    route: '/portfolio', target: '[data-tour="live-price"]',
    title: 'Fiyatları yenile',
    content: 'Veri bağlantısı açıksa bu düğme son fiyatları getirir; son güncelleme saatini de burada görürsün. Canlı veri kapalı yazıyorsa yenileme kullanılamaz. Fiyatlar veri sağlayıcısına göre gecikmeli olabilir.',
  },
  {
    route: '/portfolio', target: '[data-tour="portfolio-table"]',
    title: 'Hisselerin ve dağılımın',
    content: 'Hisselerini sütun başlıklarıyla sıralayabilir, satır düğmeleriyle düzenleyebilir veya silebilirsin. Portföy dolduğunda aşağıdaki grafikler hisse ve sektör dağılımını gösterir.',
  },
  {
    route: '/opportunities', target: '[data-tour="opp-tabs"]',
    title: 'Kısa ve uzun vadeli fırsatlar',
    content: 'Vade sekmeleri ve filtrelerle adayları incele. Kartlardaki skor, risk, kanıt gücü ve fiyat seviyelerini birlikte değerlendir; ayrıntıları açarak gerekçeleri oku. Uygun aday yoksa liste boş olabilir.',
  },
  {
    route: '/model-portfolios', target: '[data-tour="model-portfolios-types"]',
    title: 'Dört farklı model portföy',
    content: 'Risk profiline göre dört model sepeti karşılaştır. Ağırlıklar dönem başında belirlenir ve ay boyunca izlenir. Seçtiğin modelin hisse ağırlıkları, giriş aralıkları ve risk seviyeleri aşağıda yer alır.',
  },
  {
    route: '/model-portfolios', target: '[data-tour="model-performance"]',
    title: 'Model performansını karşılaştır',
    content: 'Birikmiş verilerle model getirilerini ve karşılaştırma göstergelerini incele. Dönem arşivi geçmiş sepetleri gösterir. Model hisselerini Takip Listesi’ne ekleyebilirsin; bu işlem gerçek alım kaydı oluşturmaz.',
  },
  {
    route: '/analysis', target: '[data-tour="analysis-score"]',
    title: 'Portföyüne özel analiz',
    content: 'Portföy skoru, risk, çeşitlendirme ve hisse bazındaki değerlendirmeleri birlikte oku. Portföyümü Analiz Et veya Yenile ile değerlendirme isteyebilirsin. Veri eksikliği ve AI kullanımına ilişkin açıklamalar bu sayfada gösterilir.',
  },
  {
    route: '/research', target: '[data-tour="research-tabs"]',
    title: 'Araştırma Merkezi',
    content: 'Özel Takip Panosu ile hisselerini izle; Finansal Tarama ile adayları karşılaştır. SEC & 13F bölümünde ABD şirket bildirimleri ve kurumsal hareketleri, Makro Takvim’de ekonomik olayları inceleyebilirsin.',
  },
  {
    route: '/news', target: '[data-tour="news-filters"]',
    title: 'Haberleri daralt ve kaynağı kontrol et',
    content: 'Portföyün, takip listen veya seçtiğin hisse için haberleri filtrele. Haber kartlarındaki önem, duygu ve güvenilirlik bilgilerini değerlendir; ayrıntılardan asıl kaynağı açarak doğrula.',
  },
  {
    route: '/watchlist', target: '[data-tour="watchlist-add"]',
    title: 'Takip Listesi',
    content: 'Henüz satın almadığın hisseleri hedef fiyat, vade ve notlarla takip et. Portföye taşı seçeneği alış bilgilerini tamamlayacağın formu açar; ancak kaydettiğinde portföyüne eklenir.',
  },
  {
    route: '/watchlist', target: '[data-tour="watchlist-list"]',
    title: 'Takip sırasını kendin belirle',
    content: 'Tümü, Uzun Vade ve Kısa Vade sekmeleriyle listeyi ayır. Kartları sürükleyerek veya ok düğmeleriyle sıralayabilir; Otomatik Sırala ile günlük değişim sırasına dönebilirsin.',
  },
  {
    route: '/account', target: '[data-tour="account-settings"]', authOnly: true,
    title: 'Hesap ayarların',
    content: 'Sol menüdeki kullanıcı adına dokunarak Hesabım sayfasına ulaşabilirsin. Burada kullanıcı adını ve parolanı değiştirebilirsin.',
  },
  {
    route: '/admin', target: '[data-tour="admin-panel"]', adminOnly: true,
    title: 'Kullanıcı yönetimi',
    content: 'Yönetici hesabında bu bölüm de görünür. Kullanıcı oluşturabilir, mevcut hesapları ve rollerini görebilir, gerektiğinde kullanıcı silebilirsin.',
  },
  {
    route: '/portfolio', target: '[data-tour="help-button"]', global: true,
    title: 'Tanıtıma istediğin zaman dön',
    content: 'Sağ üstteki soru işareti bu turu her sayfadan yeniden başlatır. Tur ilgili bölümlere kendisi geçer. Gösterilen analiz ve model sepetleri bilgilendirme amaçlıdır; yatırım tavsiyesi değildir.',
  },
];

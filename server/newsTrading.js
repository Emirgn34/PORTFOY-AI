import { classifyHeadline } from './newsHeuristics.js';

const DAY = 86400_000;

/** Historical scenarios are kept separate from headline interpretation. */
export function newsPriceContext(chart, { now = new Date() } = {}) {
  const quotes = [...(chart?.quotes ?? [])]
    .filter((q) => Number.isFinite(Number(q.close)) && Number(q.close) > 0 && Number.isFinite(Date.parse(q.date)) &&
      Date.parse(q.date) <= now.getTime() + 60000 &&
      // A current-session daily candle is still forming until the regular close.
      !(chart?.meta?.currentTradingPeriod?.regular?.end && Date.parse(q.date) >= Date.parse(chart.meta.currentTradingPeriod.regular.start) &&
        now.getTime() < Date.parse(chart.meta.currentTradingPeriod.regular.end)))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const latest = quotes.at(-1);
  if (!latest || quotes.length < 22) return { available: false, reason: 'En az 22 günlük geçerli kapanış gerekiyor.' };
  if (now.getTime() - Date.parse(latest.date) > 7 * DAY || Date.parse(latest.date) > now.getTime() + DAY) {
    return { available: false, reason: 'Fiyat geçmişi güncel değil; sayısal aralık üretilmedi.' };
  }
  const prices = quotes.map((q) => Number(q.adjclose) > 0 ? Number(q.adjclose) : Number(q.close));
  const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i])).slice(-60);
  // Missing adjustment around a corporate action must not create a huge target.
  if (returns.some((r) => !Number.isFinite(r) || Math.abs(r) > 0.5)) return { available: false, reason: 'Fiyat geçmişindeki kopukluk nedeniyle aralık hesaplanamadı.' };
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const sigma = Math.sqrt(returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1));
  if (!(sigma > 0)) return { available: false, reason: 'Ölçülebilir fiyat oynaklığı bulunamadı.' };
  const price = Number(latest.close);
  const ranges = [
    { horizon: 'Kısa vade · 5 işlem günü', sessions: 5 },
    { horizon: 'Uzun vade · 63 işlem günü', sessions: 63 },
  ].map((h) => ({ ...h, low: price * Math.exp(-sigma * Math.sqrt(h.sessions)), high: price * Math.exp(sigma * Math.sqrt(h.sessions)),
    downsidePercent: (Math.exp(-sigma * Math.sqrt(h.sessions)) - 1) * 100, upsidePercent: (Math.exp(sigma * Math.sqrt(h.sessions)) - 1) * 100 }));
  const recent = quotes.slice(-14);
  const trueRanges = recent.map((q, i) => {
    const previous = Number(quotes[quotes.length - recent.length + i - 1]?.close);
    const high = Number(q.high), low = Number(q.low);
    return Number.isFinite(high) && Number.isFinite(low) && high >= low && low > 0 && previous > 0
      ? Math.max(high - low, Math.abs(high - previous), Math.abs(low - previous)) : null;
  }).filter((v) => v != null);
  const atr = trueRanges.length >= 10 ? trueRanges.reduce((sum, v) => sum + v, 0) / trueRanges.length : null;
  return { available: true, price, currency: chart.meta?.currency ?? null, asOf: new Date(latest.date).toISOString(),
    sampleSessions: returns.length, dailyVolatilityPercent: sigma * 100, ranges,
    illustrativeStop: atr && price > 1.5 * atr ? price - 1.5 * atr : null,
    method: 'Son en çok 60 düzeltilmiş günlük log getirinin örnek standart sapması; son kapanış × exp(±σ√gün). Sıfır sürüklenmeli tarihsel senaryo; olasılık veya haberin fiyat hedefi değildir. Haber şoku ve fiyat boşluğu bandı aşabilir.',
    stopMethod: atr ? 'Örnek uzun pozisyon zarar kes: son kapanış − 1,5 × son 14 günün ATR değeri. Teknik destek seviyesi değildir.' : null };
}

const THEMES = [
  { label: 'Bilanço ve beklentiler', pattern: /earnings|revenue|guidance|outlook|\beps\b|bilanço|gelir|kâr|kar tahmin/i,
    shortTerm: 'Sonuç ve beklenti farkı ilk seanslarda yeniden fiyatlama ve hacim artışı yaratabilir. Önceki beklenti ve açılış boşluğu teyit edilmeli.',
    longTerm: 'Etkinin kalıcılığı sonraki bilançolarda nakit akışı, marj ve şirket tahminlerinin gerçekleşmesine bağlı.' },
  { label: 'Sözleşme ve kapasite', pattern: /contract|order|capacity|partnership|sözleşme|sipariş|kapasite|ortaklık/i,
    shortTerm: 'Açıklama ilgi ve oynaklık yaratabilir; tutar, bağlayıcılık ve mevcut gelire oranı kaynakta doğrulanmalı.',
    longTerm: 'Gelire dönüşüm takvimi, yatırım ihtiyacı ve sözleşme marjı izlenmeli; başlık tek başına kazanç artışını göstermez.' },
  { label: 'Düzenleme ve hukuki gelişme', pattern: /fda|approval|regulat|lawsuit|investigation|onay|dava|soruşturma|düzenlem/i,
    shortTerm: 'Kararın kapsamına göre ani boşluk ve sert fiyat hareketi görülebilir; kesin karar ile söylenti ayrılmalı.',
    longTerm: 'Pazara erişim, uyum maliyeti ve kararın temyiz veya uygulama süreci uzun dönem etkisini belirler.' },
  { label: 'Sermaye ve şirket işlemleri', pattern: /acqui|merger|buyback|offering|debt|dividend|satın al|birleşme|borç|temettü|sermaye/i,
    shortTerm: 'İşlem fiyatı, finansman koşulları ve sulanma ihtimali kısa vadeli fiyatlamada belirleyici olabilir.',
    longTerm: 'Borç yükü, hisse başına değer, işlemin tamamlanması ve sermaye getirisi takip edilmeli.' },
  { label: 'Makro ve sektör', pattern: /interest rate|inflation|tariff|oil|sector|faiz|enflasyon|tarife|petrol|sektör/i,
    shortTerm: 'Sektörün ortak tepkisi ile şirkete özgü hareket ayrılmalı; endeks yönü ve haberin önceden fiyatlanıp fiyatlanmadığı izlenmeli.',
    longTerm: 'Talep, girdi maliyetleri, finansman koşulları ve şirketin fiyatlama gücü uzun dönem aktarımı belirler.' },
];

export function summarizeNewsForTrading(articles, { symbol = null, query = '', chart = null, now = new Date() } = {}) {
  const recent = articles.filter((a) => a.title && Number.isFinite(Date.parse(a.publishedAt)) &&
    Date.parse(a.publishedAt) <= now.getTime() + 60000 && now.getTime() - Date.parse(a.publishedAt) <= 7 * DAY)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 12);
  const evidence = recent.slice(0, 5).map((a) => ({ id: a.id, title: a.titleTr || a.title, publisher: a.publisher, link: a.link,
    publishedAt: a.publishedAt, sentiment: /\b(?:rumou?r|may|could|denies?|not|no)\b|söylenti|yalanla/i.test(a.title)
      ? 'neutral' : classifyHeadline(a.title).sentiment }));
  const positive = evidence.filter((a) => a.sentiment === 'positive').length;
  const negative = evidence.filter((a) => a.sentiment === 'negative').length;
  const bias = positive > 0 && negative === 0 ? 'positive' : negative > 0 && positive === 0 ? 'negative' : 'neutral';
  const text = recent.map((a) => `${a.title} ${a.titleTr ?? ''}`).join(' ');
  const themes = THEMES.filter((t) => t.pattern.test(text)).map(({ label, shortTerm, longTerm }) => ({ label, shortTerm, longTerm }));
  return { symbol, query, generatedAt: now.toISOString(), evidence, bias, articleCount: recent.length,
    summary: evidence.length ? `Son 7 günde ${recent.length} haber bulundu. En yeni ${evidence.length} başlıkta ${positive} olumlu, ${negative} olumsuz, ${evidence.length - positive - negative} nötr veya belirsiz ton var. Başlık tabanlı değerlendirme; tam metin doğrulaması gerekli.` : 'Son 7 gün için doğrulanabilir tarihli haber bulunamadı. İşlem çıkarımı üretilmedi.',
    themes: evidence.length ? themes.length ? themes : [{ label: 'Genel şirket gündemi',
      shortTerm: 'Başlıklardan güvenilir bir fiyat yönü çıkarılamıyor. Hacim, fiyat tepkisi ve kaynak metindeki somut gelişme teyit edilmeli.',
      longTerm: 'Kalıcı etki için kâr, nakit akışı ve rekabet gücüne aktarım izlenmeli.' }] : [],
    priceContext: symbol ? newsPriceContext(chart, { now }) : { available: false, reason: 'Sektör için tek fiyat ve pozisyon boyutu yok. Sayısal senaryo için bir hisse seçin.' },
    condition: bias === 'positive' ? 'Olumlu başlık tek başına giriş sinyali değildir. Kaynak teyidi, fiyat ve hacim onayı sonrası örnek risk bütçesi değerlendirilebilir.' : bias === 'negative'
      ? 'Olumsuz başlık akışında yeni uzun pozisyon için önerilen tahsis %0; önce olumsuz senaryonun geçersizleşmesi beklenir.'
      : 'Yön belirsiz veya haberler çelişkili; teyit gelene kadar önerilen yeni tahsis %0.' };
}

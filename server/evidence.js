/**
 * Kanıt dedektörleri — "neden öneriliyor?" sorusunun SOMUT cevabını üretir.
 *
 * Skor motoru bir hissenin ne kadar cazip göründüğünü ölçer ama gerekçeyi
 * "teknik momentum 72/100" gibi soyut bırakır. Bu modül bunun yerine olayı
 * arar: kim, ne zaman, ne yaptı ve bunu kaç bağımsız kaynak yazdı.
 *
 * Üç kategori taranır (bkz. src/utils/conviction.js — kategori bayrakları):
 *   policy    — devlet/merkez bankası/düzenleyici kararları (tarife, teşvik, yaptırım…)
 *   analyst   — kurum notu ve hedef fiyat yükseltmeleri
 *   technical — fiyat verisinden çıkan sert teyitler (kırılım, kesişim, hacim)
 *   corporate — şirket olayları (VARSAYILAN KAPALI; conviction.js'te açılır)
 *
 * Tasarım kuralı: YÖN önemlidir. Aşağı yönlü bir olay (tarife cezası, not
 * indirimi, destek kaybı) kesinliği artırmaz — `contradictions` listesine
 * düşer ve kullanıcıya "bu tezin karşısındaki kanıt" olarak gösterilir.
 * Sadece olay saymak, kötü haberi iyi haber gibi puanlamak olurdu.
 */
import { classifyHeadline, estimatePublisherReliability } from './newsHeuristics.js';
import { scoreConviction } from '../src/utils/conviction.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Karar mercileri: açıklaması tek başına sektörü hareket ettirebilen aktörler. */
const POLICY_ACTORS =
  /\b(trump|white house|beyaz saray|biden|congress|kongre|senate|senato|fed|fomc|powell|merkez bankas|tcmb|ecb|avrupa komisyonu|european commission|\bsec\b|\bftc\b|\bdoj\b|pentagon|savunma bakanl|hazine|treasury|beijing|pekin|brüksel|brussels|kremlin|opec|opec\+)\b/i;

/** Fiyatı doğrudan etkileyen politika eylemleri. */
const POLICY_ACTIONS =
  /\b(tariff|tarife|gümrük vergi|sanction|yaptırım|subsid|teşvik|sübvansiyon|export control|ihracat kısıt|import ban|ithalat yasa|antitrust|rekabet soruşturma|executive order|kararname|rate (cut|hike|decision)|faiz (indirim|artırım|karar)|stimulus|kamu ihale|defense budget|savunma bütçe|quota|kota|embargo|regulation|düzenleme|price cap|tavan fiyat|nationaliz|kamulaştır)\w*/i;

/** Politika olayının hisse için OLUMLU olduğunu gösteren kalıplar. */
const POLICY_UPSIDE =
  /\b(exempt|muafiyet|muaf tutul|lifts?|kaldır|eases?|gevşet|approv|onay|subsid|teşvik|sübvansiyon|stimulus|destek paketi|rate cut|faiz indirim|awards?|ihale.{0,15}(verildi|kazan)|budget increase|bütçe artır|deal reached|anlaşma sağlandı)\w*/i;

/** Analist aksiyonu: yükseltme / hedef fiyat artışı. */
const ANALYST_UPGRADE =
  /(hedef fiyat[^.]{0,25}(yükselt|artır|yukarı)|price target[^.]{0,20}(rais|increas|boost|hike|up)|\b(upgrade[sd]?|upgrades)\b|(raised|raises) to (buy|outperform|overweight|accumulate)|(not|derece|tavsiye)[^.]{0,20}(yükselt|artır)|\bal(ış)? tavsiye|initiate[sd]? .{0,15}(buy|outperform))/i;

/** Analist aksiyonu: indirim (çelişki tarafına yazılır). */
const ANALYST_DOWNGRADE =
  /(hedef fiyat[^.]{0,25}(düşür|indir|aşağı)|price target[^.]{0,20}(cut|lower|reduc|slash)|\b(downgrade[sd]?|downgrades)\b|(cut|lowered) to (sell|underperform|underweight)|(not|derece|tavsiye)[^.]{0,20}(düşür|indir))/i;

/** Şirket olayları (kategori varsayılan olarak KAPALI — bkz. conviction.js). */
const CORPORATE_EVENT =
  /\b(acquisition|acquires?|merger|takeover|buyback|repurchase|beats? (estimate|expectation)|record (revenue|profit|orders|backlog)|wins? .{0,30}(contract|order|tender)|fda approv)\w*|(satın al(ma|ım|dı)|birleşme|geri alım|beklentileri aştı|rekor (kar|kâr|gelir|sipariş)|(sözleşme|ihale|anlaşma)[^.]{0,20}(kazan|imzala|aldı))/i;

/** Haber satırını ortak bir şekle getirir (başlık Türkçeyse onu kullanır). */
function normalizeRow(row, referenceMs) {
  const title = row.title_tr || row.title || '';
  const publisher = row.publisher ?? 'Bilinmeyen Kaynak';
  const ageDays = row.published_at
    ? Math.max(0, (referenceMs - new Date(row.published_at)) / DAY_MS)
    : null;
  return {
    title,
    // Orijinal başlık da taranır: çeviri kimi zaman kalıbı bozar
    searchText: `${title} ${row.title ?? ''}`,
    publisher,
    link: row.link ?? null,
    ageDays,
    reliability: Number.isFinite(row.reliability)
      ? row.reliability
      : estimatePublisherReliability(publisher),
  };
}

/**
 * Aynı olayı yazan bağımsız yayıncı sayısı. Teyit ölçüsüdür: bir başlığı
 * yalnızca tek bir site yazmışsa "kesin" demek için erkendir.
 */
function countSources(rows, matcher, referenceDays, windowDays = 3) {
  const publishers = new Set();
  for (const r of rows) {
    if (r.ageDays == null || referenceDays == null) continue;
    if (Math.abs(r.ageDays - referenceDays) > windowDays) continue;
    if (matcher(r)) publishers.add(r.publisher.toLowerCase());
  }
  return publishers.size;
}

/** Politika/makro kanıtı: karar mercii + eylem aynı başlıkta geçiyor mu? */
function detectPolicyEvidence(rows) {
  const matcher = (r) => POLICY_ACTORS.test(r.searchText) && POLICY_ACTIONS.test(r.searchText);
  const hits = rows.filter(matcher);
  if (hits.length === 0) return null;

  // En taze + en güvenilir olanı temsilci seç
  const lead = [...hits].sort(
    (a, b) => b.reliability - a.reliability || (a.ageDays ?? 999) - (b.ageDays ?? 999)
  )[0];

  const sourceCount = countSources(rows, matcher, lead.ageDays);
  const tone = classifyHeadline(lead.title).sentiment;
  const upside = POLICY_UPSIDE.test(lead.searchText);
  // Yön: açık olumlu kalıp varsa yukarı, başlık tonu olumsuzsa aşağı
  const direction = upside ? 'up' : tone === 'negative' ? 'down' : tone === 'positive' ? 'up' : 'neutral';

  let strength = 52;
  if (lead.reliability >= 8) strength += 12; // ajans/resmi bildirim
  else if (lead.reliability >= 7) strength += 6;
  if (sourceCount >= 3) strength += 12;
  else if (sourceCount >= 2) strength += 7;
  if (upside) strength += 5;

  return {
    category: 'policy',
    type: 'Politika kararı',
    direction,
    strength: clamp(strength),
    ageDays: lead.ageDays,
    sourceCount,
    reliability: lead.reliability,
    sources: [lead.publisher],
    title: lead.title,
    link: lead.link,
    text:
      `${lead.publisher}: "${lead.title}" — düzenleyici/politika kaynaklı bir karar ` +
      `${sourceCount > 1 ? `${sourceCount} ayrı yayıncı tarafından doğrulandı` : 'tek kaynakta yer aldı'}.`,
  };
}

/** Analist kanıtı: yükseltme başlığı + hedef fiyat mesafesiyle güçlendirilir. */
function detectAnalystEvidence(rows, analyst, price) {
  const upMatcher = (r) => ANALYST_UPGRADE.test(r.searchText);
  const downHits = rows.filter((r) => ANALYST_DOWNGRADE.test(r.searchText));
  const upHits = rows.filter(upMatcher);

  // İndirim varsa ve yükseltmeden tazeyse tez zayıflar → çelişki olarak dön
  const freshestDown = downHits.sort((a, b) => (a.ageDays ?? 999) - (b.ageDays ?? 999))[0];
  const freshestUp = upHits.sort((a, b) => (a.ageDays ?? 999) - (b.ageDays ?? 999))[0];
  if (freshestDown && (!freshestUp || freshestDown.ageDays < freshestUp.ageDays)) {
    return {
      category: 'analyst',
      type: 'Analist indirimi',
      direction: 'down',
      strength: 55,
      ageDays: freshestDown.ageDays,
      sourceCount: 1,
      reliability: freshestDown.reliability,
      sources: [freshestDown.publisher],
      title: freshestDown.title,
      link: freshestDown.link,
      text: `${freshestDown.publisher}: "${freshestDown.title}" — kurum beklentisini AŞAĞI çekti.`,
    };
  }
  if (!freshestUp) return null;

  const upsidePct =
    analyst?.targetMean && price ? ((analyst.targetMean / price - 1) * 100) : null;
  const sourceCount = countSources(rows, upMatcher, freshestUp.ageDays);

  let strength = 48;
  if (freshestUp.reliability >= 8) strength += 10;
  if (sourceCount >= 2) strength += 10;
  if (upsidePct != null && upsidePct >= 20) strength += 12;
  else if (upsidePct != null && upsidePct >= 10) strength += 8;
  else if (upsidePct != null && upsidePct < 0) strength -= 18; // fiyat, hedefin ÜSTÜNE çıkmış
  if ((analyst?.count ?? 0) >= 8) strength += 4;

  const targetNote =
    upsidePct != null
      ? ` ${analyst.count} analistin ortalama hedefi ${analyst.targetMean.toFixed(2)} — bugünkü fiyatın %${upsidePct.toFixed(0)} ${upsidePct >= 0 ? 'üzerinde' : 'altında'}.`
      : '';

  return {
    category: 'analyst',
    type: 'Analist yükseltmesi',
    direction: 'up',
    strength: clamp(strength),
    ageDays: freshestUp.ageDays,
    sourceCount,
    reliability: freshestUp.reliability,
    sources: [freshestUp.publisher],
    title: freshestUp.title,
    link: freshestUp.link,
    text: `${freshestUp.publisher}: "${freshestUp.title}".${targetNote}`,
  };
}

/** Şirket olayı kanıtı (kategori kapalıyken de tespit edilir, puana katılmaz). */
function detectCorporateEvidence(rows) {
  const matcher = (r) => CORPORATE_EVENT.test(r.searchText);
  const hits = rows.filter(matcher);
  if (hits.length === 0) return null;

  const lead = [...hits].sort(
    (a, b) => b.reliability - a.reliability || (a.ageDays ?? 999) - (b.ageDays ?? 999)
  )[0];
  const sourceCount = countSources(rows, matcher, lead.ageDays);
  const tone = classifyHeadline(lead.title).sentiment;

  let strength = 60;
  if (lead.reliability >= 8) strength += 12;
  if (sourceCount >= 2) strength += 10;

  return {
    category: 'corporate',
    type: 'Şirket olayı',
    direction: tone === 'negative' ? 'down' : 'up',
    strength: clamp(strength),
    ageDays: lead.ageDays,
    sourceCount,
    reliability: lead.reliability,
    sources: [lead.publisher],
    title: lead.title,
    link: lead.link,
    text: `${lead.publisher}: "${lead.title}".`,
  };
}

/**
 * Teknik kanıt: fiyat verisinden çıkan sert teyitler TEK bir kanıtta birleşir.
 * Sinyaller birbiriyle yüksek korelasyonlu olduğu için ayrı ayrı sayılmaz;
 * en güçlüsü taban alınır, her ek teyit sınırlı bir katkı yapar.
 */
function detectTechnicalEvidence(tech, metrics, price) {
  if (!tech) return null; // hafif analizde (2 yıllık geçmiş yok) teknik kanıt üretilmez

  const signals = [];

  // 52 hafta zirvesi kırılımı — en sert teyitlerden biri
  if (tech.pctFrom52High != null && tech.pctFrom52High >= -1.5 && (tech.ret20 ?? 0) > 0) {
    signals.push({
      strength: tech.rsi != null && tech.rsi > 82 ? 56 : 68, // aşırı alımda temkinli
      text: `Fiyat 52 haftanın zirvesinde (zirveye uzaklık %${Math.abs(tech.pctFrom52High).toFixed(1)}) ve son 20 günde %${tech.ret20} yükseldi.`,
    });
  }

  // Altın kesişim + 200 günlük ortalamanın üstü
  if (tech.goldenCross && (tech.pctVsSma200 ?? 0) > 0) {
    signals.push({
      strength: 58,
      text: `50 günlük ortalama 200 günlüğün üzerinde (altın kesişim) ve fiyat 200 günlüğün %${tech.pctVsSma200} üstünde.`,
    });
  }

  // Hacim patlaması — hareketin arkasında gerçek para var mı?
  if ((metrics.volumeConfirmationScore ?? 0) >= 85) {
    signals.push({
      strength: 60,
      text: `İşlem hacmi normalin belirgin üzerinde (${metrics.volumeSignal}); hareket hacimle teyitli.`,
    });
  } else if ((metrics.volumeConfirmationScore ?? 0) >= 75) {
    signals.push({
      strength: 50,
      text: `İşlem hacmi ortalamanın üzerinde (${metrics.volumeSignal}).`,
    });
  }

  // Güçlü destekten dönüş — çok test edilmiş seviyenin hemen üstünde toparlanma
  const support = tech.priceStructure?.nearestSupport;
  if (support && support.touches >= 3 && support.distancePct >= -4 && (tech.ret5 ?? 0) > 0) {
    signals.push({
      strength: 62,
      text: `Fiyat, geçmişte ${support.touches} kez test edilmiş ${support.level} desteğinin %${Math.abs(support.distancePct)} üzerinde ve son 5 günde toparlanıyor.`,
    });
  }

  if (signals.length === 0) return null;

  // Sinyaller birbiriyle korelasyonlu (hepsi aynı fiyat serisinden) — ek teyit
  // sınırlı katkı yapar, toplama YAPILMAZ.
  signals.sort((a, b) => b.strength - a.strength);
  const strength = clamp(signals[0].strength + Math.min(10, (signals.length - 1) * 5));

  return {
    category: 'technical',
    type: 'Teknik kırılım',
    direction: 'up',
    strength,
    ageDays: null, // bugünkü durum — yaşlanmaz
    sourceCount: signals.length, // kaç bağımsız teknik sinyal doğruluyor
    reliability: null, // kaynak itibarı kavramı fiyat verisi için geçersiz
    sources: ['Fiyat verisi'],
    title: signals[0].text,
    link: null,
    text: signals.map((s) => s.text).join(' '),
  };
}

/**
 * Bir aday için tüm kanıtları toplar ve kesinlik skorunu üretir.
 *
 * @returns {{ score, level, categories, evidence, contradictions, penalties }}
 */
export function buildConviction({ newsRows, metrics, tech, price, referenceMs, context = {} }) {
  const rows = (newsRows ?? []).map((r) => normalizeRow(r, referenceMs));

  const detected = [
    detectPolicyEvidence(rows),
    detectAnalystEvidence(rows, metrics?.analyst, price),
    detectTechnicalEvidence(tech, metrics ?? {}, price),
    detectCorporateEvidence(rows),
  ].filter(Boolean);

  // Yalnızca YUKARI yönlü kanıtlar kesinliği besler; aşağı yönlüler tezin
  // karşısındaki delil olarak ayrı gösterilir.
  const supporting = detected.filter((e) => e.direction === 'up');
  const contradictions = detected.filter((e) => e.direction === 'down');

  const result = scoreConviction(supporting, context);

  // Karşı kanıt varsa kesinlik doğrudan kırpılır: "kesin" demek için tezin
  // karşısında taze bir delil bulunmaması gerekir.
  let score = result.score;
  if (contradictions.length > 0) {
    score = Math.round(score * 0.7);
  }

  return {
    score,
    categories: result.categories,
    evidence: supporting,
    contradictions,
    penalties: [
      ...result.penalties,
      ...(contradictions.length > 0
        ? ['Tezin karşısında taze bir kanıt var; kesinlik %30 kırpıldı.']
        : []),
    ],
  };
}

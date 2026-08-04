/**
 * Kesinlik (kanıt gücü) motoru — SAF çekirdek, bağımlılık YOK.
 *
 * Fırsat skoru "bu hisse ne kadar cazip?" sorusunu ölçer; kesinlik ise farklı
 * bir soruyu: "bu cazipliğin arkasında SOMUT, doğrulanabilir bir sebep var mı?"
 * Yüksek skorlu ama sebebi belirsiz bir aday, düşük skorlu ama net bir olayla
 * desteklenen adaydan daha az işe yarar — kullanıcı "şu oldu, bu yüzden
 * öneriliyor" cümlesini kuramıyorsa liste gürültüdür.
 *
 * Bu yüzden kesinlik AYRI bir kapı olarak çalışır: skor sıralamayı, kesinlik
 * ise vitrine kimin çıkacağını belirler. Eşiği geçen aday yoksa liste boş kalır
 * — zayıf sinyali güçlü gibi göstermek, sistemin tek gerçek sermayesi olan
 * güvenilirliği harcar.
 *
 * ÖNEMLİ: Kesinlik "kâr olasılığı" DEĞİLDİR. Kanıtın ne kadar sert, taze,
 * çok kaynaklı ve kendi içinde tutarlı olduğunu ölçer.
 */

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/**
 * Kanıt kategorileri. `enabled: false` olan kategori tespit edilse bile
 * kesinlik skoruna KATILMAZ (yalnızca bilgi amaçlı taşınır).
 */
export const EVIDENCE_CATEGORIES = {
  policy: {
    enabled: true,
    label: 'Politika / makro',
    description: 'Devlet, merkez bankası veya düzenleyici kaynaklı karar ve açıklamalar',
  },
  analyst: {
    enabled: true,
    label: 'Analist hedefi',
    description: 'Kurum notu yükseltmeleri ve hedef fiyat artışları',
  },
  technical: {
    enabled: true,
    label: 'Teknik kırılım',
    description: 'Fiyat verisinden çıkan sert teyitler (kırılım, kesişim, hacim)',
  },
  corporate: {
    enabled: true,
    label: 'Şirket olayı',
    description: 'Bilanço sürprizi, satın alma, büyük sözleşme, geri alım',
  },
};

/**
 * Kesinlik eşiği: vitrine çıkmak için gereken minimum kanıt gücü.
 * TEK AYAR NOKTASI — liste çok doluysa yükselt, sürekli boşsa düşür.
 */
export const CONVICTION_THRESHOLD = 78;

/**
 * Vitrine çıkmak için gereken minimum BAĞIMSIZ kanıt kategorisi sayısı.
 * Tek kanıt — ne kadar güçlü olursa olsun — tesadüf olabilir; iki farklı
 * türden kanıtın aynı yönü göstermesi çok daha zor taklit edilir.
 */
export const MIN_EVIDENCE_CATEGORIES = 2;

/**
 * "Sebep" sayılan kategoriler: dışarıda GERÇEKLEŞMİŞ bir olaya dayananlar.
 *
 * Teknik kırılım bilerek bu listede değil. Grafik, olan bir şeyin sonucunu
 * gösterir, sebebini değil — "yükseldiği için yükselecek" bir gerekçe değildir.
 * Bu yüzden teknik sinyal yalnızca TEYİT olarak sayılır: vitrine çıkmak için
 * mutlaka bir olay kanıtı (politika kararı, analist yükseltmesi…) gerekir.
 */
export const EVENT_CATEGORIES = ['policy', 'analyst', 'corporate'];

/** Eşiğe yaklaşan ama geçemeyen adayların gösterileceği alt sınır. */
export const NEAR_MISS_THRESHOLD = 60;

/** Haber temelli kanıtın tazelik çarpanı: 2 gün tam, sonra 5 gün yarı ömür. */
function freshnessFactor(ageDays) {
  if (ageDays == null) return 1; // teknik kanıt = bugünkü durum, yaşlanmaz
  const stale = Math.max(0, ageDays - 2);
  return Math.max(0.3, Math.pow(0.5, stale / 5));
}

/** Kanıtın tazelik uygulanmış etkin gücü. */
export function effectiveStrength(item) {
  return item.strength * freshnessFactor(item.ageDays);
}

/**
 * Kanıt listesinden kesinlik skoru üretir.
 *
 * Mantık:
 *  - Taban (ÇIPA): en güçlü OLAY kanıtı — tazelik uygulanmış. Olay yoksa en
 *    güçlü kanıt taban alınır (ve tek-kategori kırpması zaten devreye girer).
 *    Çıpanın olay olması şart: aksi halde 12 gün önceki zayıf bir yükseltme,
 *    güçlü bir grafik sayesinde "kesin" sayılabilirdi — oysa kesinliği veren
 *    olayın kendisi, grafik yalnızca onu teyit eder.
 *  - Bonus: FARKLI kategorideki her ek kanıt tabanı yukarı çeker (azalan katkı,
 *    tavan +18). Aynı kategoriden ikinci kanıt bonus vermez — üç analist notu
 *    tek bir olayın tekrarıdır, bağımsız teyit değildir.
 *  - Çarpanlar: tek kaynaklı haber, çelişen haber akışı ve yüksek risk skoru
 *    aşağı çeker. Kanıtın kendisi kadar, kanıtın etrafındaki gürültü de önemli.
 *
 * @param evidence [{ category, type, strength, ageDays, sourceCount, text }]
 * @param context  { riskLevel, positiveNewsCount, negativeNewsCount }
 */
export function scoreConviction(evidence = [], context = {}) {
  const active = evidence.filter((e) => EVIDENCE_CATEGORIES[e.category]?.enabled);
  if (active.length === 0) {
    return { score: 0, categories: [], strongest: null, penalties: [] };
  }

  const sorted = [...active].sort((a, b) => effectiveStrength(b) - effectiveStrength(a));
  // Çıpa: varsa en güçlü OLAY kanıtı, yoksa en güçlü kanıt
  const strongest = sorted.find((e) => EVENT_CATEGORIES.includes(e.category)) ?? sorted[0];
  let score = effectiveStrength(strongest);

  // Farklı kategorilerden gelen teyitler (azalan katkı)
  const seen = new Set([strongest.category]);
  let bonus = 0;
  let factor = 0.3;
  for (const item of sorted) {
    if (seen.has(item.category)) continue;
    seen.add(item.category);
    bonus += effectiveStrength(item) * factor;
    factor *= 0.6; // 3. kategori 2.'den az katar
  }
  score += Math.min(18, bonus);

  // --- Aşağı çeken çarpanlar ---
  const penalties = [];
  const { riskLevel, positiveNewsCount = 0, negativeNewsCount = 0 } = context;

  // Tek TÜRDEN kanıt, ne kadar güçlü olursa olsun teyitsizdir: teknik kırılım
  // haberle desteklenmiyorsa (ya da tersi) tesadüf olma ihtimali yüksektir.
  // Bu kırpma olmadan skor ile kapı çelişirdi — "Çok Yüksek Kesinlik" etiketi
  // taşıyan bir aday vitrine giremezdi.
  if (seen.size < 2) {
    score *= 0.8;
    penalties.push('Tek türden kanıt var; farklı bir kaynak türünden teyit yok.');
  }

  // Haber temelli en güçlü kanıt tek kaynaktan geliyorsa teyitsizdir — ancak
  // birinci sınıf kaynaklar (ajans / resmi bildirim, güvenilirlik ≥8) tek başına
  // da teyit sayılır: Reuters'ın yazdığı bir tarife kararının "gerçekten oldu mu"
  // sorusu yoktur. Ceza, ikinci kaynağın gerçekten bilgi kattığı durumlar için.
  if (
    strongest.ageDays != null &&
    (strongest.sourceCount ?? 1) < 2 &&
    (strongest.reliability ?? 5) < 8
  ) {
    score *= 0.85;
    penalties.push('En güçlü kanıt tek ve orta güvenilirlikte bir kaynaktan geliyor.');
  }
  // Haber akışı çelişiyorsa (olumsuz başlıklar baskınsa) kanıt zayıflar
  if (negativeNewsCount > positiveNewsCount && negativeNewsCount > 0) {
    score *= 0.8;
    penalties.push(
      `Haber akışı çelişkili: ${negativeNewsCount} olumsuz başlığa karşı ${positiveNewsCount} olumlu.`
    );
  }
  if (riskLevel === 'Yüksek') {
    score *= 0.9;
    penalties.push('Yüksek volatilite, kanıt doğru olsa bile sonucun sapma ihtimalini artırıyor.');
  }

  return {
    // Tavan bilerek 97: bu motor bir olayın GERÇEKLEŞTİĞİNİ doğrulayabilir,
    // fiyatın tepki vereceğini değil. "100 kesinlik" dürüst bir ifade olmaz.
    score: Math.round(clamp(score, 0, 97)),
    categories: [...seen],
    strongest,
    penalties,
  };
}

/** Kesinlik skorunun sözel karşılığı. */
export function getConvictionLevel(score) {
  if (score >= 85) return 'Çok Yüksek Kesinlik';
  if (score >= CONVICTION_THRESHOLD) return 'Yüksek Kesinlik';
  if (score >= NEAR_MISS_THRESHOLD) return 'Eşiğe Yakın';
  if (score > 0) return 'Zayıf Kanıt';
  return 'Kanıt Yok';
}

/** Kesinlik rozetinin renkleri (skor renkleriyle aynı sakin palet). */
export function getConvictionColor(score) {
  if (score >= CONVICTION_THRESHOLD) {
    return { text: 'text-gain', badge: 'border-gain/40 bg-gain/15 text-gain' };
  }
  if (score >= NEAR_MISS_THRESHOLD) {
    return { text: 'text-amber-400', badge: 'border-amber-400/30 bg-amber-400/15 text-amber-400' };
  }
  return { text: 'text-slate-400', badge: 'border-navy-700 bg-navy-800 text-slate-400' };
}

/**
 * Aday vitrine (kesin fırsatlar listesine) çıkabilir mi?
 * Üç koşul BİRLİKTE aranır:
 *   1. Kanıt gücü eşiği geçmeli,
 *   2. En az iki farklı kanıt türü aynı yönü göstermeli,
 *   3. Bunlardan en az biri gerçek bir OLAY olmalı (yalnızca grafik yetmez).
 */
export function passesConvictionGate(conviction) {
  if (!conviction) return false;
  const categories = conviction.categories ?? [];
  return (
    conviction.score >= CONVICTION_THRESHOLD &&
    categories.length >= MIN_EVIDENCE_CATEGORIES &&
    categories.some((c) => EVENT_CATEGORIES.includes(c))
  );
}

/**
 * AI gerekçesi yokken (anahtar tanımsız veya çağrı atlandı) gösterilecek
 * özet cümle. Kanıtların kendi metinleri zaten tam cümle olduğu için burada
 * yalnızca "kaç farklı kanıt, hangi türden" bilgisi verilir.
 */
export function summarizeEvidence(conviction) {
  const items = conviction?.evidence ?? [];
  if (items.length === 0) return 'Bu aday için somut bir kanıt bulunamadı.';

  const labels = [...new Set(items.map((e) => EVIDENCE_CATEGORIES[e.category]?.label ?? e.category))];
  if (labels.length === 1) {
    return `Tek türden kanıt var: ${labels[0].toLowerCase()}.`;
  }
  return `${labels.length} farklı türden kanıt aynı yönü gösteriyor: ${labels
    .map((l) => l.toLowerCase())
    .join(' + ')}.`;
}

/** Kapıdan geçemeyen adayın SEBEBİ — boş ekranda kullanıcıya açıklanır. */
export function getGateFailureReason(conviction) {
  if (!conviction || conviction.score === 0) return 'Somut bir kanıt bulunamadı.';
  const categories = conviction.categories ?? [];
  if (!categories.some((c) => EVENT_CATEGORIES.includes(c))) {
    return 'Yalnızca grafik sinyali var; arkasında somut bir olay (karar, açıklama, yükseltme) yok.';
  }
  if (categories.length < MIN_EVIDENCE_CATEGORIES) {
    return 'Tek türden kanıt var; ikinci bir kaynak türü doğrulamıyor.';
  }
  return `Kanıt gücü ${conviction.score}/100 ile eşiğin (${CONVICTION_THRESHOLD}) altında kaldı.`;
}

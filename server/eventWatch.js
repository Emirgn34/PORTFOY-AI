/**
 * OLAY NÖBETİ — "6 saat sonra öğrenmek" sorununun çözümü.
 *
 * SORUN: Kanıt tespiti aday turunun içindeydi ve aday turu 6 saatte bir koşuyor
 * (tüm ABD evrenini tarayıp sembol başına 2 yıllık grafik çektiği için daha sık
 * koşamaz). Yani bir tarife kararı ya da satın alma açıklaması sabah 09:05'te
 * çıktığında sistem bunu 6 saat sonra fark ediyordu — fırsatın en değerli kısmı
 * çoktan fiyatlanmış oluyordu.
 *
 * ÇÖZÜM — iki hızı ayırmak:
 *   YAVAŞ (6 saat, aday turu): evren taraması, 2 yıllık grafik, RSI, destek
 *     seviyeleri, temel veriler. Bunlar gün içinde kayda değer değişmez.
 *   HIZLI (20 dakika, bu modül): yalnızca TAZE HABER çekilir ve kanıt motoru
 *     yeniden çalıştırılır. Yavaş göstergeler `techSnapshot` alanından okunur,
 *     fiyat/hacme bağlı olanlar taze quote'tan yeniden hesaplanır.
 *
 * Böylece olay-fark-etme süresi 6 saatten ~20 dakikaya iner, ağır iş
 * tekrarlanmadan.
 *
 * KAPSAM DÜRÜSTLÜĞÜ: Nöbet, en son turun vitrinindeki semboller + kullanıcının
 * izlediği semboller üzerinde çalışır (~100 sembol). Hiç aday listesine
 * girmemiş bir hissedeki olay yine 6 saatlik tam taramada yakalanır — 6000
 * sembolün haberini 20 dakikada bir çekmek ne teknik olarak mümkün ne de
 * kaynak sağlayıcıların izin vereceği bir şey.
 *
 * MALİYET: Yeni bir aday kesinlik eşiğini GEÇTİĞİNDE tek bir AI çağrısı yapılır.
 * Sakin bir turda hiç AI çağrısı olmaz.
 */
import { buildConviction } from './evidence.js';
import { buildVolumeSignal } from './candidateBuilder.js';
import { passesConvictionGate } from '../src/utils/conviction.js';
import { confirmConviction, isConvictionAiEnabled } from './convictionAnalysis.js';
import { mapLimit } from './concurrency.js';

/** Nöbette AI teyidine gönderilecek azami YENİ aday (maliyet tavanı). */
const MAX_NEW_CONFIRMATIONS = 10;
/** Kanıt gücü bu kadar değiştiyse aday satırı yeniden yazılır (gereksiz yazımı önler). */
const REWRITE_DELTA = 5;

/**
 * Değerlendirme için gereken ALANLAR — aday satırının tamamı değil.
 *
 * Aday `data` blob'u ~5 KB (haber listesi, beklenti sürücüleri, uzun gerekçe
 * metni). Nöbet 20 dakikada bir 90 satır okuduğu için tamamını çekmek ayda
 * ~2 GB'a çıkardı; Supabase ücretsiz kotası 5 GB. PostgREST'in jsonb yol
 * seçimiyle yalnızca gerekli alanlar alınır, tam satır SADECE kanıtı değişen
 * semboller için okunur (turda tipik olarak 0-5 sembol).
 */
const LIGHT_FIELDS = [
  'symbol',
  'generation',
  'snap:data->techSnapshot',
  'ps:data->priceStructure',
  'conv:data->conviction',
  'analyst:data->analystTarget',
  'risk:data->riskLevel',
  'price:data->currentPrice',
  'ticker:data->symbol',
  'company:data->companyName',
  'sector:data->sector',
  'posNews:data->positiveNewsCount',
  'negNews:data->negativeNewsCount',
  'volSignal:data->volumeSignal',
  'edge:data->expectation',
];
/** İç içe jsonb yolu — PostgREST sürümüne göre desteklenmeyebilir, ayrı tutulur. */
const NESTED_FIELD = 'volScore:data->scoreBreakdown->volumeConfirmationScore';

/**
 * Hafif satırları okur. İç içe jsonb yol seçimi eski PostgREST sürümlerinde
 * hata verebildiği için o alan olmadan bir kez daha denenir: hacim skoru zaten
 * taze quote'tan yeniden hesaplanıyor, yedek yol yalnızca quote gelmeyen
 * semboller için kullanılıyor. Bu alan yüzünden tüm nöbetin düşmesi anlamsız.
 */
async function readLightRows(sb) {
  try {
    return await sb(`candidates?horizon=eq.short&select=${[...LIGHT_FIELDS, NESTED_FIELD].join(',')}`);
  } catch (err) {
    console.error(`[nöbet] iç içe alan seçimi başarısız, yedek sorgu deneniyor: ${err.message}`);
    return sb(`candidates?horizon=eq.short&select=${LIGHT_FIELDS.join(',')}`);
  }
}

/**
 * Hafif satırdan kanıt motorunun beklediği `tech` nesnesini kurar.
 * Yavaş göstergeler anlık görüntüden, 52 hafta yakınlığı ise TAZE fiyattan
 * gelir — kırılımın bugün gerçekleşmiş olması ihtimali tam da aradığımız şey.
 */
function rebuildTech(row, quote) {
  if (!row.snap) return null;

  const price = quote?.regularMarketPrice ?? row.price;
  const high52 = quote?.fiftyTwoWeekHigh ?? null;
  const pctFrom52High =
    price && high52 ? Number(((price / high52 - 1) * 100).toFixed(1)) : row.snap.pctFrom52High;

  return { ...row.snap, pctFrom52High, priceStructure: row.ps ?? null };
}

/**
 * Kanıt kümesinin kimliği. Aynı olaylar duruyorsa gerekçe cümlesi hâlâ
 * geçerlidir; skor tazelik/hacimle oynasa bile yeniden AI'a sorulmaz.
 *
 * Teknik kanıt için yalnızca KATEGORİ kullanılır, metni değil: o metin
 * ("zirveye uzaklık %0.7") her fiyat hareketinde değişir, dolayısıyla metne
 * bakan bir imza her turda "kanıt değişti" derdi ve maliyet kontrolü yok olurdu.
 * Teknik teyidin varlığı/yokluğu anlamlıdır, ondalıkları değil.
 */
function evidenceSignature(conviction) {
  return (conviction?.evidence ?? [])
    .map((e) => (e.ageDays == null ? e.category : `${e.category}:${e.title ?? e.type}`))
    .sort()
    .join('|');
}

/** Hafif satırdan kanıt motorunun beklediği `metrics` nesnesini kurar. */
function rebuildMetrics(row, quote) {
  const volume = quote ? buildVolumeSignal(quote) : null;
  return {
    volumeConfirmationScore: volume?.volumeConfirmationScore ?? row.volScore ?? 50,
    volumeSignal: volume?.volumeSignal ?? row.volSignal,
    riskLevel: row.risk,
    analyst: row.analyst ?? null,
  };
}

/**
 * Vitrindeki adaylar için TAZE haberle kanıtı yeniden değerlendirir.
 *
 * @param deps.sb              Supabase PostgREST yardımcısı (collect.js'ten)
 * @param deps.quoteMap        Sembol → taze quote (data turunda zaten çekildi)
 * @param deps.getNewsForSymbol Sembolün son haberlerini DB'den okur
 * @returns { checked, updated, promoted } — promoted: yeni eşiği geçenler
 */
export async function runEventWatch({ sb, quoteMap, getNewsForSymbol }) {
  const referenceMs = Date.now();

  // Sembol başına TEK satır okunur: kısa ve uzun vade aynı kanıtı paylaşır,
  // ikisini de çekmek okunan veriyi gereksiz yere ikiye katlardı.
  const rows = await readLightRows(sb);
  if (!rows?.length) {
    console.log('Olay nöbeti: aday tablosu boş, atlandı.');
    return { checked: 0, updated: 0, promoted: 0 };
  }

  // Yalnızca EN GÜNCEL jenerasyon — eskiler bayat, vitrinde görünmüyorlar
  const latestGeneration = Math.max(...rows.map((r) => r.generation ?? 0));
  const current = rows.filter((r) => (r.generation ?? 0) === latestGeneration && r.snap);
  if (current.length === 0) {
    console.log(
      'Olay nöbeti: adaylarda teknik anlık görüntü yok — bir sonraki aday turundan sonra aktifleşir.'
    );
    return { checked: 0, updated: 0, promoted: 0 };
  }

  const changed = [];
  const promoted = [];

  await mapLimit(current, 6, async (row) => {
    const quote = quoteMap.get(row.symbol) ?? null;

    let newsRows;
    try {
      newsRows = await getNewsForSymbol(row.symbol);
    } catch {
      return;
    }

    const conviction = buildConviction({
      newsRows,
      metrics: rebuildMetrics(row, quote),
      tech: rebuildTech(row, quote),
      price: quote?.regularMarketPrice ?? row.price,
      referenceMs,
      context: {
        riskLevel: row.risk,
        positiveNewsCount: row.posNews,
        negativeNewsCount: row.negNews,
      },
    });

    const previous = row.conv ?? { score: 0, evidence: [] };
    const wasPassing = passesConvictionGate(previous);
    const isPassing = passesConvictionGate(conviction);

    // Gerekçe cümlesi OLAYA aittir, skora değil: kanıt kümesi aynı kaldığı
    // sürece devralınır. Eşiğin sınırındaki bir aday gün içinde girip çıksa
    // bile aynı olay için ikinci kez AI ücreti ödenmez.
    if (evidenceSignature(conviction) === evidenceSignature(previous)) {
      conviction.verdict = previous.verdict ?? null;
      conviction.verdictRisk = previous.verdictRisk ?? null;
      conviction.aiCertainty = previous.aiCertainty ?? null;
    }

    // AI teyidi yalnızca YENİ bir kanıt vitrine çıktığında çalışır
    const willPromote =
      isPassing && row.edge?.hasActionableEdge !== false && !conviction.verdict;
    if (willPromote) {
      promoted.push({
        symbol: row.ticker ?? row.symbol,
        yahooSymbol: row.symbol,
        companyName: row.company,
        sector: row.sector,
        conviction,
      });
    }

    // Yazma koşulu: skor kayda değer oynadı VEYA vitrin durumu değişti VEYA
    // yeni bir gerekçe üretilecek. Sonuncusu şart: aynı kategoride yeni bir
    // olayda skor sabit kalabilir ama gerekçe cümlesi yenilenir — satır
    // yazılmazsa AI'a ödenen çağrı boşa gider.
    if (
      willPromote ||
      Math.abs(conviction.score - (previous.score ?? 0)) >= REWRITE_DELTA ||
      isPassing !== wasPassing
    ) {
      changed.push({ yahooSymbol: row.symbol, conviction });
    }
  });

  // --- Yeni yükselenler için tek AI turu (tavanlı) ---
  if (promoted.length > 0 && isConvictionAiEnabled()) {
    await confirmConviction(promoted.slice(0, MAX_NEW_CONFIRMATIONS));
  }
  // AI, promoted[].conviction nesnesini yerinde günceller; changed listesi aynı
  // nesneye işaret ettiği için yazıma otomatik yansır.
  const aiBySymbol = new Map(promoted.map((p) => [p.yahooSymbol, p.conviction]));

  // --- Yalnızca değişen sembollerin TAM satırları okunur ve geri yazılır ---
  let written = 0;
  if (changed.length > 0) {
    const symbolList = changed.map((c) => c.yahooSymbol);
    const convictionBySymbol = new Map(
      changed.map((c) => [c.yahooSymbol, aiBySymbol.get(c.yahooSymbol) ?? c.conviction])
    );
    const fullRows = await sb(
      `candidates?symbol=in.(${symbolList.map((s) => `"${s}"`).join(',')})&select=symbol,horizon,market,data,generation`
    );
    const writes = (fullRows ?? [])
      .filter((r) => (r.generation ?? 0) === latestGeneration)
      .map((r) => ({
        symbol: r.symbol,
        horizon: r.horizon,
        market: r.market,
        data: { ...r.data, conviction: convictionBySymbol.get(r.symbol) ?? r.data.conviction },
        generation: r.generation,
        updated_at: new Date().toISOString(),
      }));

    if (writes.length > 0) {
      await sb('candidates', { method: 'POST', body: writes, prefer: 'resolution=merge-duplicates' });
      written = writes.length;
    }
  }

  console.log(
    `Olay nöbeti: ${current.length} sembol değerlendirildi, ${changed.length} adayın kanıtı değişti ` +
      `(${written} satır yazıldı), ${promoted.length} aday kesinlik eşiğini YENİ geçti.`
  );
  return { checked: current.length, updated: changed.length, promoted: promoted.length };
}

/** Vitrin sembolleri kaç turda bir tazelenir (20 dk × 3 ≈ saatte bir). */
const SHOWCASE_ROTATION = 3;

/**
 * Nöbet planı: NE ÇEKİLECEK ve NE DEĞERLENDİRİLECEK ayrı sorulardır.
 *
 * Değerlendirme ucuzdur (haberler zaten veritabanında) → her turda TÜM vitrine
 * uygulanır. Haber çekmek pahalıdır ve kaynak sağlayıcıların hız sınırlarına
 * takılabilir → önceliklendirilir:
 *   - Kullanıcının kendi sembolleri HER TURDA (20 dk): geç kalmanın gerçekten
 *     para kaybettirdiği yer burasıdır.
 *   - Vitrin sembolleri DÖNÜŞÜMLÜ (~1 saat): sabit bir üçte biri her turda.
 *
 * Böylece haber trafiği ~3 katı azalır ama bir sembole haber düştüğü anda,
 * o haber veritabanına girdiği turdan itibaren TÜM değerlendirmelerde görünür.
 */
export async function getWatchPlan(sb, trackedSymbols) {
  const tracked = [...new Set(trackedSymbols)];
  let showcase = [];
  try {
    const rows = await sb('candidates?select=symbol,generation');
    if (rows?.length) {
      const latest = Math.max(...rows.map((r) => r.generation ?? 0));
      showcase = [
        ...new Set(rows.filter((r) => (r.generation ?? 0) === latest).map((r) => r.symbol)),
      ].filter((s) => !tracked.includes(s));
    }
  } catch {
    // aday tablosu okunamadıysa yalnızca izlenen sembollerle devam
  }

  // Durumsuz dönüşüm: hangi turda olduğumuzu saatten türetiriz, böylece
  // ayrıca bir "son tarama" alanı tutmaya gerek kalmaz.
  const slot = Math.floor(Date.now() / (20 * 60 * 1000)) % SHOWCASE_ROTATION;
  const rotating = showcase.filter((_, i) => i % SHOWCASE_ROTATION === slot);

  return {
    evaluate: [...tracked, ...showcase],
    fetch: [...tracked, ...rotating],
  };
}

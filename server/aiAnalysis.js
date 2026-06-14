/**
 * Haber analizi — Claude Haiku 4.5 ile her başlığa duygu, güvenilirlik ve
 * kısa Türkçe özet üretir. Hem bulut toplayıcı (collect.js) tarafından
 * kullanılır; sonuçlar Supabase'e yazılır ve sitede gösterilir.
 *
 * ANTHROPIC_API_KEY yoksa sessizce devre dışı kalır (boş Map döner) ve
 * toplayıcı AI'sız çalışmaya devam eder — eski davranış korunur.
 *
 * Maliyet: Haiku 4.5 ($1/MTok girdi, $5/MTok çıktı). Yalnızca YENİ makaleler
 * analiz edildiği için tahmini aylık maliyet çok düşüktür (~$2-5/ay).
 */
import Anthropic from '@anthropic-ai/sdk';

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-haiku-4-5';
const BATCH_SIZE = 15; // tek çağrıda analiz edilecek makale sayısı
// 15 makale × (duygu + güvenilirlik + tek cümle Türkçe özet) çıktısı 2000 token'a
// sığmıyordu → yanıt kesilip JSON bozuluyordu. Bol pay bırakıyoruz (non-streaming).
const MAX_TOKENS = 8000;

const client = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;

/** AI analizi açık mı (anahtar tanımlı mı)? */
export function isAiEnabled() {
  return Boolean(client);
}

const SYSTEM_PROMPT =
  'Sen bir finansal haber analistisin. Sana hisse senedi haber başlıkları ' +
  'verilecek; her biri için ilgili hisse açısından şunları üret:\n' +
  '- sentiment: haberin o hisse için OLASI FİYAT ETKİSİ yönündeki tonu.\n' +
  '  * "positive": olumlu ima — büyüme, yeni anlaşma/sözleşme, beklenti üstü ' +
  'bilanço, hedef fiyat artışı, olumlu analist görüşü, ucuz değerleme fırsatı, ' +
  'talep artışı, ürün/pazar genişlemesi vb.\n' +
  '  * "negative": olumsuz ima — düşüş, dava/soruşturma, zayıf bilanço, hedef ' +
  'fiyat indirimi, regülasyon baskısı, maliyet/marj baskısı, rekabet tehdidi, ' +
  'talep zayıflığı vb.\n' +
  '  * "neutral": SADECE haber gerçekten iki yönlü/dengeliyse VEYA o hisseyle ' +
  'doğrudan ilgili değilse (genel piyasa yorumu, hisseden yalnızca örnek olarak ' +
  'bahseden listeler).\n' +
  '  ÖNEMLİ: Çoğu şirkete özgü haberin bir yönü vardır. Emin olamadığında "neutral"e ' +
  'KAÇMA; başlığın baskın tonuna göre pozitif veya negatif seç. "neutral" yalnızca ' +
  'son çare olmalı.\n' +
  '- reliability: 1-10 arası güvenilirlik. Kaynağın itibarını (Reuters/Bloomberg/' +
  'KAP yüksek; tıklama tuzağı/spekülatif bloglar düşük) ve başlığın abartılı/' +
  'sansasyonel olup olmadığını birlikte değerlendir.\n' +
  '- summary_tr: başlığa dayanan, tek cümlelik akıcı Türkçe özet/çıkarım.\n' +
  'Yalnızca verilen başlık bilgisine dayan; uydurma yapma.';

const SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
          reliability: { type: 'integer' },
          summary_tr: { type: 'string' },
        },
        required: ['id', 'sentiment', 'reliability', 'summary_tr'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

function clampReliability(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, n));
}

/** Tek bir makale grubunu analiz eder; başarısız olursa boş dizi döner. */
async function analyzeBatch(batch) {
  const lines = batch.map(
    (a) =>
      `- id: ${a.id} | pazar: ${a.market} | kaynak: ${a.publisher ?? 'bilinmiyor'} | başlık: ${a.title}`
  );
  const userPrompt =
    'Aşağıdaki haberleri analiz et ve her id için sonuç döndür:\n\n' + lines.join('\n');

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    });
    if (response.stop_reason === 'max_tokens') {
      console.error(`[ai] uyarı: yanıt max_tokens'a takıldı (batch=${batch.length}); JSON kesilmiş olabilir.`);
    }
    const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.results) ? parsed.results : [];
  } catch (err) {
    console.error(`[ai] analiz hatası: ${err.message}`);
    return [];
  }
}

/**
 * Makale listesini analiz eder. Girdi: [{ id, title, publisher, market }].
 * Dönüş: Map<id, { sentiment, reliability, summaryTr }>.
 * Anahtar yoksa veya hata olursa eksik/boş Map döner (çağıran taraf bunu
 * tolere etmeli — AI alanları opsiyoneldir).
 */
export async function analyzeArticles(articles) {
  const byId = new Map();
  if (!client || articles.length === 0) return byId;

  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);
    const results = await analyzeBatch(batch);
    for (const r of results) {
      if (!r?.id) continue;
      byId.set(r.id, {
        sentiment: ['positive', 'negative', 'neutral'].includes(r.sentiment)
          ? r.sentiment
          : 'neutral',
        reliability: clampReliability(r.reliability),
        summaryTr: typeof r.summary_tr === 'string' ? r.summary_tr.trim() : null,
      });
    }
  }
  return byId;
}

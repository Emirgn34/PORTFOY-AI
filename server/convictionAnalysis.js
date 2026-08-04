/**
 * Kesinlik teyidi — turun TEK AI kalemi (Claude Haiku 4.5).
 *
 * Rolü bilinçli olarak dar: yeni kanıt ARAMAZ, kanıt UYDURMAZ. Kural motorunun
 * (server/evidence.js) çıkardığı somut kanıtları okur ve iki şey yapar:
 *   1. Kanıtın gerçekten o hisseyi yukarı taşıyacak kadar DOĞRUDAN olup
 *      olmadığına karar verir (ör. "sektör hakkında genel yorum" ile "bu şirkete
 *      tarife muafiyeti tanındı" arasındaki farkı regex göremez),
 *   2. Kullanıcının okuyacağı tek cümlelik NEDENSEL gerekçeyi yazar
 *      ("şu oldu → bu yüzden öneriliyor").
 *
 * SÖZLEŞME: AI kesinliği YALNIZCA AŞAĞI çekebilir. Kural skoru tavan, model
 * bir kırpma çarpanıdır. Böylece bir halüsinasyon listeye aday SOKAMAZ; en
 * kötü ihtimalle doğru bir adayı eler.
 *
 * MALİYET: Haber hattındaki AI kaldırıldığı için ödenen tek kalem burasıdır.
 * ~30 finalist, 10'arlı partiler → aday turu başına ~3 çağrı, günde 4 tur →
 * ~12 çağrı/gün (~$0,10). Kıyas: eski haber hattı günde ~400 çağrı yapıyordu.
 *
 * MALİYET DERSİ: Eski motor, her makalenin kimliği olarak Google News URL'sini
 * (medyan 213 karakter) prompt'a koyuyor ve modelden aynen geri yazmasını
 * istiyordu — token'ların yarısı buna gidiyordu, üstelik çıktı 5 kat pahalı.
 * Burada kimlik olarak 1'den başlayan SIRA NUMARASI kullanılır, eşleme yerelde
 * yapılır.
 */
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5';
/** Tek çağrıda değerlendirilecek aday sayısı. */
const BATCH_SIZE = 10;
/** Turda yapılacak azami çağrı — beklenmedik bir döngüde bile fatura sabit kalır. */
const MAX_CALLS = 4;
/** Tek çağrı için üst süre sınırı (ms); takılan istek turu kilitlemesin. */
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 2000;

const SYSTEM_PROMPT =
  'Sen deneyimli bir yatırım analistisin. Sana hisse başına ZATEN TESPİT EDİLMİŞ ' +
  'kanıtlar veriliyor. Görevin yeni kanıt aramak veya bilgi eklemek DEĞİL; ' +
  'verilen kanıtı değerlendirmek.\n\n' +
  'Her hisse için karar ver:\n' +
  '- certainty (0-100): Bu kanıt, hissenin yakın vadede yukarı hareket etmesi ' +
  'için ne kadar DOĞRUDAN ve SOMUT bir sebep? Yüksek puan yalnızca kanıt (a) bu ' +
  'şirketi doğrudan ilgilendiriyorsa, (b) somut bir olaya dayanıyorsa ve (c) ' +
  'etkisi fiyata daha önce tam yansımamışsa verilir. Genel piyasa yorumu, ' +
  'sektör listesi, "şu hisseler öne çıktı" tipi içerik ve zaten haftalardır ' +
  'bilinen gelişmeler DÜŞÜK puan alır.\n' +
  '- decisive: certainty 70 ve üzeriyse true, değilse false.\n' +
  '- verdict_tr: Kullanıcıya gösterilecek NEDENSEL gerekçe. Kalıp: "<somut olay> ' +
  'olduğu için <beklenen etki>." En fazla 2 cümle, sade Türkçe, rakam varsa ' +
  'kullan. Kanıtta OLMAYAN hiçbir bilgiyi ekleme.\n' +
  '- risk_tr: Bu tezi bozabilecek en önemli tek unsur (bir cümle). Yoksa null.\n\n' +
  'Kanıt zayıfsa bunu açıkça söyle — düşük certainty vermekten çekinme. ' +
  'Yanıltıcı bir "kesin fırsat" etiketi, kaçırılmış bir fırsattan çok daha pahalıdır.';

const SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          certainty: { type: 'integer' },
          decisive: { type: 'boolean' },
          verdict_tr: { type: 'string' },
          risk_tr: { type: ['string', 'null'] },
        },
        required: ['i', 'certainty', 'decisive', 'verdict_tr'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Anahtar tanımlı mı? Yoksa tüm katman sessizce atlanır (kural skoru aynen kalır). */
export function isConvictionAiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Bir adayı prompt satırına çevirir. Kimlik = sıra numarası (token tasarrufu). */
function formatCandidate(candidate, index) {
  const lines = [
    `${index}. ${candidate.symbol} — ${candidate.companyName} (${candidate.sector ?? 'sektör bilinmiyor'})`,
    `   kural motorunun kanıt gücü: ${candidate.conviction.score}/100`,
  ];
  for (const e of candidate.conviction.evidence) {
    const age = e.ageDays == null ? 'bugünkü durum' : `${Math.round(e.ageDays)} gün önce`;
    lines.push(`   - [${e.type}, ${age}] ${e.text}`);
  }
  for (const c of candidate.conviction.contradictions ?? []) {
    lines.push(`   - [KARŞI KANIT] ${c.text}`);
  }
  return lines.join('\n');
}

/** Tek partiyi değerlendirir; hata olursa boş dizi (kural skoru korunur). */
async function evaluateBatch(client, batch, offset) {
  const userPrompt =
    'Aşağıdaki hisseler için kanıtları değerlendir ve her sıra numarası (i) için ' +
    'sonuç döndür:\n\n' +
    batch.map((c, k) => formatCandidate(c, offset + k + 1)).join('\n\n');

  try {
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      },
      { timeout: REQUEST_TIMEOUT_MS }
    );
    if (response.stop_reason === 'max_tokens') {
      console.error(`[kesinlik] uyarı: yanıt max_tokens'a takıldı (parti=${batch.length}).`);
    }
    const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.results) ? parsed.results : [];
  } catch (err) {
    console.error(`[kesinlik] parti hatası: ${err.message}`);
    return [];
  }
}

/**
 * Finalistlerin kesinliğini AI ile teyit eder ve gerekçe cümlesini yazar.
 * Adayları YERİNDE günceller (candidate.conviction alanına yazar).
 *
 * @param candidates Kanıtı olan adaylar (çağıran taraf sayıyı sınırlar)
 * @returns işlenen aday sayısı
 */
export async function confirmConviction(candidates) {
  if (!isConvictionAiEnabled() || !candidates?.length) return 0;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const byIndex = new Map(candidates.map((c, i) => [i + 1, c]));
  let processed = 0;

  const batchCount = Math.min(MAX_CALLS, Math.ceil(candidates.length / BATCH_SIZE));
  for (let b = 0; b < batchCount; b++) {
    const offset = b * BATCH_SIZE;
    const batch = candidates.slice(offset, offset + BATCH_SIZE);
    if (batch.length === 0) break;

    const results = await evaluateBatch(client, batch, offset);
    for (const r of results) {
      const candidate = byIndex.get(r.i);
      if (!candidate) continue;

      const certainty = clamp(Number(r.certainty) || 0);
      // AI YALNIZCA aşağı çeker: 100 → çarpan 1.0, 0 → çarpan 0.6.
      const factor = 0.6 + 0.4 * (certainty / 100);
      const ruleScore = candidate.conviction.score;

      candidate.conviction = {
        ...candidate.conviction,
        ruleScore,
        score: Math.round(ruleScore * factor),
        aiCertainty: certainty,
        aiDecisive: Boolean(r.decisive),
        verdict: typeof r.verdict_tr === 'string' ? r.verdict_tr.trim() : null,
        verdictRisk: typeof r.risk_tr === 'string' && r.risk_tr.trim() ? r.risk_tr.trim() : null,
      };
      processed++;
    }
  }

  console.log(`Kesinlik teyidi: ${processed}/${candidates.length} aday AI ile değerlendirildi.`);
  return processed;
}

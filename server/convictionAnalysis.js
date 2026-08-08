/**
 * Kural motorunun bulduğu somut kanıtlar için dar kapsamlı Claude teyidi.
 *
 * Model yeni sinyal veya kullanıcı metni üretmez; yalnızca kanıtın doğrudanlığını
 * sınıflandırır. Gerekçe ve risk mevcut kanıtlardan yerel olarak oluşturulur.
 * Sonuç kanıt imzasıyla Supabase'de cache'lenir ve aynı olay tekrar ücretlenmez.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  buildDecisionCacheKey,
  canSpendAi,
  loadDecisionCache,
  recordAiUsage,
  storeDecisionCache,
} from './aiControl.js';

const MODEL = process.env.ANTHROPIC_CONVICTION_MODEL || 'claude-haiku-4-5';
const PROMPT_VERSION = 'conviction-v2-compact';
const BATCH_SIZE = 10;
const MAX_CALLS = 4;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 600;
const BATCH_POLL_MS = 10_000;
const BATCH_WAIT_MS = Number(process.env.ANTHROPIC_BATCH_WAIT_MS) || 55 * 60_000;

const SYSTEM_PROMPT =
  'Verilen şirket kanıtlarını yalnızca doğrudanlık, somutluk, yenilik ve henüz fiyatlanmamış olma açısından sınıflandır. ' +
  'Yeni bilgi ekleme ve yatırım metni yazma. Her sıra için 0-100 certainty ve tek reason_code döndür.';

const REASON_CODES = [
  'DIRECT_NEW_EVENT',
  'DIRECT_BUT_PRICED',
  'INDIRECT_SECTOR_NEWS',
  'STALE_EVENT',
  'WEAK_OR_GENERIC',
  'CONTRADICTED',
];

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
          reason_code: { type: 'string', enum: REASON_CODES },
        },
        required: ['i', 'certainty', 'reason_code'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isConvictionAiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function formatCandidate(candidate, index) {
  const lines = [
    `${index}. ${candidate.symbol} (${candidate.sector ?? 'sektör bilinmiyor'})`,
    `kural skoru=${candidate.conviction.score}`,
  ];
  for (const evidence of candidate.conviction.evidence ?? []) {
    const age = evidence.ageDays == null ? 'yaş bilinmiyor' : `${Math.round(evidence.ageDays)}g`;
    lines.push(`+ [${evidence.type},${age}] ${evidence.text}`);
  }
  for (const contradiction of candidate.conviction.contradictions ?? []) {
    lines.push(`- [karşı] ${contradiction.text}`);
  }
  return lines.join('\n');
}

function requestParams(batch, offset) {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content:
          'Her sıra için sınıflandırma yap:\n\n' +
          batch.map((candidate, index) => formatCandidate(candidate, offset + index + 1)).join('\n\n'),
      },
    ],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  };
}

function parseMessage(message) {
  const text = message?.content?.find((block) => block.type === 'text')?.text ?? '{}';
  const parsed = JSON.parse(text);
  return Array.isArray(parsed.results) ? parsed.results : [];
}

async function evaluateStandard(client, candidates) {
  const results = [];
  const batchCount = Math.min(MAX_CALLS, Math.ceil(candidates.length / BATCH_SIZE));
  for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
    const offset = batchIndex * BATCH_SIZE;
    const batch = candidates.slice(offset, offset + BATCH_SIZE);
    if (!batch.length) break;
    try {
      const response = await client.messages.create(requestParams(batch, offset), {
        timeout: REQUEST_TIMEOUT_MS,
      });
      await recordAiUsage('conviction', response, {
        model: MODEL,
        candidates: batch.length,
        promptVersion: PROMPT_VERSION,
      });
      results.push(...parseMessage(response));
    } catch (error) {
      console.error(`[kesinlik] parti hatası: ${error.message}`);
    }
  }
  return results;
}

async function evaluateBatchApi(client, candidates) {
  const batchCount = Math.min(MAX_CALLS, Math.ceil(candidates.length / BATCH_SIZE));
  const requests = [];
  for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
    const offset = batchIndex * BATCH_SIZE;
    const batch = candidates.slice(offset, offset + BATCH_SIZE);
    if (!batch.length) break;
    requests.push({ custom_id: `conviction-${offset}`, params: requestParams(batch, offset) });
  }

  const job = await client.messages.batches.create({ requests });
  console.log(`[kesinlik] Batch API işi oluşturuldu: ${job.id} (${requests.length} parti).`);
  const deadline = Date.now() + BATCH_WAIT_MS;
  let state = job;
  while (state.processing_status !== 'ended' && Date.now() < deadline) {
    await wait(BATCH_POLL_MS);
    state = await client.messages.batches.retrieve(job.id);
  }
  if (state.processing_status !== 'ended') {
    await client.messages.batches.cancel(job.id).catch(() => null);
    throw new Error(`Batch API ${Math.round(BATCH_WAIT_MS / 60_000)} dakikada tamamlanmadı ve iptal edildi`);
  }

  const results = [];
  const decoder = await client.messages.batches.results(job.id);
  for await (const item of decoder) {
    if (item.result.type !== 'succeeded') {
      console.error(`[kesinlik] ${item.custom_id} batch sonucu: ${item.result.type}`);
      continue;
    }
    const message = item.result.message;
    await recordAiUsage('conviction', message, {
      model: MODEL,
      batch: true,
      promptVersion: PROMPT_VERSION,
      customId: item.custom_id,
    });
    results.push(...parseMessage(message));
  }
  return results;
}

function strongestEvidence(candidate) {
  const evidence = [...(candidate.conviction.evidence ?? [])];
  evidence.sort((a, b) => Number(b.strength ?? 0) - Number(a.strength ?? 0));
  return evidence[0]?.text?.trim() || 'Somut kanıt kural motoru tarafından doğrulandı.';
}

function applyDecision(candidate, decision, { cacheHit = false } = {}) {
  const certainty = clamp(Number(decision?.certainty) || 0);
  const factor = 0.6 + 0.4 * (certainty / 100);
  const ruleScore = candidate.conviction.ruleScore ?? candidate.conviction.score;
  const contradiction = candidate.conviction.contradictions?.[0]?.text?.trim() || null;
  candidate.conviction = {
    ...candidate.conviction,
    ruleScore,
    score: Math.round(ruleScore * factor),
    aiCertainty: certainty,
    aiDecisive: certainty >= 70,
    aiReasonCode: REASON_CODES.includes(decision?.reason_code) ? decision.reason_code : 'WEAK_OR_GENERIC',
    aiCacheHit: cacheHit,
    aiModel: MODEL,
    aiPromptVersion: PROMPT_VERSION,
    verdict: strongestEvidence(candidate),
    verdictRisk: contradiction,
  };
}

/**
 * Adayları yerinde günceller. Cache isabetleri dahil değerlendirilen aday sayısını döndürür.
 */
export async function confirmConviction(candidates) {
  if (!isConvictionAiEnabled() || !candidates?.length) return 0;

  const limited = candidates.slice(0, BATCH_SIZE * MAX_CALLS);
  const descriptors = limited.map((candidate) => ({
    candidate,
    ...buildDecisionCacheKey(candidate, MODEL, PROMPT_VERSION),
  }));
  const cached = await loadDecisionCache(descriptors);
  const pending = [];
  let processed = 0;

  for (const descriptor of descriptors) {
    const decision = cached.get(descriptor.cacheKey);
    if (decision) {
      applyDecision(descriptor.candidate, decision, { cacheHit: true });
      processed++;
    } else {
      pending.push(descriptor);
    }
  }

  if (!pending.length) {
    console.log(`Kesinlik teyidi: ${processed}/${limited.length} aday kalıcı cache'den geldi; Claude çağrılmadı.`);
    return processed;
  }

  if (!(await canSpendAi({ reserveUsd: 0.02 }))) return processed;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const useBatch = process.env.ANTHROPIC_USE_BATCH === 'true';
  let results = [];
  try {
    results = useBatch
      ? await evaluateBatchApi(client, pending.map((item) => item.candidate))
      : await evaluateStandard(client, pending.map((item) => item.candidate));
  } catch (error) {
    console.error(`[kesinlik] AI değerlendirmesi atlandı: ${error.message}`);
    return processed;
  }

  const cacheEntries = [];
  for (const result of results) {
    const descriptor = pending[Number(result.i) - 1];
    if (!descriptor) continue;
    const decision = {
      certainty: clamp(Number(result.certainty) || 0),
      reason_code: REASON_CODES.includes(result.reason_code) ? result.reason_code : 'WEAK_OR_GENERIC',
    };
    applyDecision(descriptor.candidate, decision);
    cacheEntries.push({
      cacheKey: descriptor.cacheKey,
      evidenceSignature: descriptor.evidenceSignature,
      symbol: descriptor.candidate.symbol,
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      result: decision,
    });
    processed++;
  }
  await storeDecisionCache(cacheEntries);

  console.log(
    `Kesinlik teyidi: ${processed}/${limited.length} aday değerlendirildi; ` +
      `${cached.size} cache isabeti, ${cacheEntries.length} yeni karar.`
  );
  return processed;
}

export const __test = { applyDecision, parseMessage, strongestEvidence };

/**
 * Claude maliyet kontrolü ve kalıcı karar önbelleği.
 *
 * Supabase tabloları henüz kurulmadıysa uygulama çalışmaya devam eder. Bu durumda
 * aynı process içindeki sayaç/cache kullanılır; kalıcı koruma için
 * supabase/ai-control-schema.sql dosyası bir kez çalıştırılmalıdır.
 */
import { createHash } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DEFAULT_DAILY_BUDGET_USD = 1;
const DEFAULT_CACHE_TTL_DAYS = 14;
const HAIKU_PRICES_PER_MILLION = {
  input: 1,
  output: 5,
  cacheWrite: 1.25,
  cacheRead: 0.1,
};

const memoryCache = new Map();
let processSpendUsd = 0;
const warned = new Set();

function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function envNumber(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function restHeaders(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function rest(path, options = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Supabase service yapılandırması yok');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: restHeaders(options.headers),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`Supabase ${response.status}: ${detail}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function normalizedEvidence(conviction = {}) {
  const normalize = (item) => ({
    type: item?.type ?? null,
    text: String(item?.text ?? '').trim().replace(/\s+/g, ' '),
    publishedAt: item?.publishedAt ?? item?.published_at ?? null,
    source: item?.source ?? item?.publisher ?? null,
  });
  return {
    evidence: (conviction.evidence ?? []).map(normalize).sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b))
    ),
    contradictions: (conviction.contradictions ?? []).map(normalize).sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b))
    ),
  };
}

export function buildEvidenceSignature(conviction) {
  return sha256(JSON.stringify(normalizedEvidence(conviction)));
}

export function buildDecisionCacheKey(candidate, model, promptVersion) {
  const signature = buildEvidenceSignature(candidate?.conviction);
  const symbol = String(candidate?.symbol ?? '').trim().toUpperCase();
  return {
    cacheKey: sha256(`${symbol}|${signature}|${model}|${promptVersion}`),
    evidenceSignature: signature,
  };
}

export function estimateClaudeCost(usage = {}, { batch = false } = {}) {
  const inputTokens = finiteNumber(usage.input_tokens);
  const outputTokens = finiteNumber(usage.output_tokens);
  const cacheWriteTokens = finiteNumber(usage.cache_creation_input_tokens);
  const cacheReadTokens = finiteNumber(usage.cache_read_input_tokens);
  const standardCost =
    (inputTokens * HAIKU_PRICES_PER_MILLION.input +
      outputTokens * HAIKU_PRICES_PER_MILLION.output +
      cacheWriteTokens * HAIKU_PRICES_PER_MILLION.cacheWrite +
      cacheReadTokens * HAIKU_PRICES_PER_MILLION.cacheRead) /
    1_000_000;
  return Number((standardCost * (batch ? 0.5 : 1)).toFixed(8));
}

export async function getDailyAiSpend() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await rest(
      `ai_daily_usage?usage_date=eq.${today}&select=estimated_cost_usd`
    );
    return (rows ?? []).reduce((sum, row) => sum + finiteNumber(row.estimated_cost_usd), 0);
  } catch (error) {
    warnOnce('usage-read', `[ai-budget] Kalıcı sayaç okunamadı; process sayacı kullanılıyor: ${error.message}`);
    return processSpendUsd;
  }
}

export async function canSpendAi({ reserveUsd = 0 } = {}) {
  const budget = envNumber('AI_DAILY_BUDGET_USD', DEFAULT_DAILY_BUDGET_USD);
  if (budget === 0) return false;
  const spent = await getDailyAiSpend();
  const allowed = spent + Math.max(0, reserveUsd) < budget;
  if (!allowed) {
    console.warn(`[ai-budget] Günlük $${budget.toFixed(2)} sınırı doldu (harcanan ~$${spent.toFixed(4)}). AI atlandı.`);
  }
  return allowed;
}

export async function recordAiUsage(flow, responseOrUsage, metadata = {}) {
  const usage = responseOrUsage?.usage ?? responseOrUsage ?? {};
  const batch = Boolean(metadata.batch);
  const estimatedCostUsd = estimateClaudeCost(usage, { batch });
  processSpendUsd += estimatedCostUsd;

  const payload = {
    p_flow: String(flow || 'unknown'),
    p_input_tokens: finiteNumber(usage.input_tokens),
    p_output_tokens: finiteNumber(usage.output_tokens),
    p_cache_creation_tokens: finiteNumber(usage.cache_creation_input_tokens),
    p_cache_read_tokens: finiteNumber(usage.cache_read_input_tokens),
    p_estimated_cost_usd: estimatedCostUsd,
    p_metadata: { ...metadata, batch },
  };

  console.log(
    `[ai-usage] flow=${payload.p_flow} input=${payload.p_input_tokens} output=${payload.p_output_tokens} ` +
      `cacheRead=${payload.p_cache_read_tokens} cost~=$${estimatedCostUsd.toFixed(6)}${batch ? ' batch' : ''}`
  );

  try {
    await rest('rpc/record_ai_usage', { method: 'POST', body: JSON.stringify(payload) });
  } catch (error) {
    warnOnce('usage-write', `[ai-usage] Kalıcı kullanım kaydı yazılamadı: ${error.message}`);
  }
  return estimatedCostUsd;
}

export async function loadDecisionCache(descriptors) {
  const now = Date.now();
  const found = new Map();
  const missing = [];

  for (const descriptor of descriptors) {
    const cached = memoryCache.get(descriptor.cacheKey);
    if (cached && cached.expiresAt > now) found.set(descriptor.cacheKey, cached.result);
    else missing.push(descriptor.cacheKey);
  }

  if (!missing.length) return found;
  try {
    const filter = encodeURIComponent(`(${missing.join(',')})`);
    const rows = await rest(
      `ai_decision_cache?cache_key=in.${filter}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}` +
        '&select=cache_key,result,expires_at'
    );
    for (const row of rows ?? []) {
      const expiresAt = new Date(row.expires_at).getTime();
      memoryCache.set(row.cache_key, { result: row.result, expiresAt });
      found.set(row.cache_key, row.result);
    }
  } catch (error) {
    warnOnce('cache-read', `[ai-cache] Kalıcı cache okunamadı: ${error.message}`);
  }
  return found;
}

export async function storeDecisionCache(entries) {
  if (!entries.length) return;
  const ttlDays = envNumber('AI_CACHE_TTL_DAYS', DEFAULT_CACHE_TTL_DAYS);
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000).toISOString();
  const now = new Date().toISOString();
  const rows = entries.map((entry) => {
    memoryCache.set(entry.cacheKey, { result: entry.result, expiresAt: new Date(expiresAt).getTime() });
    return {
      cache_key: entry.cacheKey,
      symbol: entry.symbol,
      model: entry.model,
      prompt_version: entry.promptVersion,
      evidence_signature: entry.evidenceSignature,
      result: entry.result,
      expires_at: expiresAt,
      updated_at: now,
    };
  });
  try {
    await rest('ai_decision_cache', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(rows),
    });
  } catch (error) {
    warnOnce('cache-write', `[ai-cache] Kalıcı cache yazılamadı: ${error.message}`);
  }
}

export const __test = {
  reset() {
    memoryCache.clear();
    processSpendUsd = 0;
    warned.clear();
  },
};

import { createClient } from '@supabase/supabase-js';

// İstemci MODÜL DÜZEYİNDE memoize edilir. Sebep yalnızca bağlantı maliyeti
// değil: tradeData.js'teki bağlam önbelleği (contextCache) istemci nesnesiyle
// anahtarlanan bir WeakMap'tir — her çağrıda yeni istemci üretmek, webhook
// yolunda o önbelleği tamamen devre dışı bırakıyordu (madde 19).
let cachedDb = null;
let cachedDbKey = '';

export function automationDb() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Sunucu veri bağlantısı kurulmamış.');
  const envKey = `${url}\n${key}`;
  if (!cachedDb || cachedDbKey !== envKey) {
    cachedDb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    cachedDbKey = envKey;
  }
  return cachedDb;
}
export function checked(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
export async function recordMonitor(sb, id, data) {
  checked(await sb.from('monitor_status').upsert({ id, updated_at: new Date().toISOString(), data }));
}

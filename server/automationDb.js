import { createClient } from '@supabase/supabase-js';

export function automationDb() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Sunucu veri bağlantısı kurulmamış.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function checked(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
export async function recordMonitor(sb, id, data) {
  checked(await sb.from('monitor_status').upsert({ id, updated_at: new Date().toISOString(), data }));
}

import { supabase } from './supabaseClient.js';
export async function automationRequest(action, { method = 'GET', body } = {}) {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) throw new Error('Bu özellik için hesabınıza giriş yapın.');
  const response = await fetch(`/api/account?feature=automation&action=${encodeURIComponent(action)}`, {
    method, headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'İstek tamamlanamadı.');
  return data;
}

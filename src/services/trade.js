import { supabase } from './supabaseClient.js';

export async function tradeRequest(action = 'state', { method = 'GET', body, signal, query } = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('Trade isteği zaman aşımına uğradı. Bağlantıyı kontrol edip yeniden deneyin.')), 12000);
  let rejectOnAbort;
  try {
    controller.signal.throwIfAborted();
    const aborted = new Promise((_, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
    });
    const operation = (async () => {
      const session = supabase ? (await supabase.auth.getSession()).data.session : null;
      controller.signal.throwIfAborted();
      if (!session) throw new Error('Trade ekranı için hesabınıza giriş yapın.');
      const params = new URLSearchParams({ feature: 'trade', action });
      for (const key of ['page', 'pageSize', 'period', 'mode', 'status', 'symbol', 'strategy']) {
        if (query?.[key] != null && query[key] !== '') params.set(key, String(query[key]));
      }
      const response = await fetch(`/api/account?${params}`, {
        method,
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        cache: 'no-store',
      });
      const result = await response.json().catch(() => ({}));
      controller.signal.throwIfAborted();
      if (!response.ok) throw new Error(result.error || 'Trade verileri alınamadı.');
      return result;
    })();
    return await Promise.race([operation, aborted]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
    if (rejectOnAbort) controller.signal.removeEventListener('abort', rejectOnAbort);
  }
}

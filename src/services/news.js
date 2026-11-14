import { supabase } from './supabaseClient.js';

export async function newsRequest(action = 'feed', { symbol, symbols, query, limit, signal } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('Haber isteği zaman aşımına uğradı. Yeniden deneyin.')), 25000);
  let onAbort;
  try {
    controller.signal.throwIfAborted();
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    const operation = (async () => {
      const session = supabase ? (await supabase.auth.getSession()).data.session : null;
      controller.signal.throwIfAborted();
      if (!session) throw new Error('Haber analizi için hesabınıza giriş yapın.');
      const params = new URLSearchParams({ feature: 'news', action });
      if (symbol) params.set('symbol', symbol);
      if (symbols?.length) params.set('symbols', symbols.join(','));
      if (query) params.set('q', query);
      if (limit) params.set('limit', String(limit));
      const response = await fetch(`/api/account?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }, signal: controller.signal, cache: 'no-store',
      });
      const result = await response.json().catch(() => ({}));
      controller.signal.throwIfAborted();
      if (!response.ok) throw new Error(result.error || 'Haberler alınamadı.');
      return result;
    })();
    return await Promise.race([operation, aborted]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
  }
}

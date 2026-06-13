/**
 * Portföy Yorumu istemci servisi.
 * - loadCachedAnalysis: kullanıcının kayıtlı analizini Supabase'den okur (AI'sız).
 * - runAnalysis: /api/analyze-portfolio'yu kullanıcının token'ıyla çağırır
 *   (gerçek skorlar + tek Claude çağrısı), sonucu döndürür ve sunucu kaydeder.
 */
import { supabase } from './supabaseClient.js';
import { getAccessToken } from './auth.js';

/** Kullanıcının en son kayıtlı analizini getirir (yoksa null). */
export async function loadCachedAnalysis() {
  if (!supabase) return null;
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from('portfolio_analyses')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data.data;
}

/** Portföyü analiz ettirir (AI). Dönüş: analiz nesnesi. Hata fırlatabilir. */
export async function runAnalysis(holdings) {
  const token = await getAccessToken();
  if (!token) throw new Error('Analiz için giriş gerekli.');
  const res = await fetch('/api/analyze-portfolio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      holdings: holdings.map((s) => ({
        ticker: s.ticker,
        company: s.company,
        market: s.market,
        quantity: s.quantity,
        avgPrice: s.avgPrice,
        currentPrice: s.currentPrice,
        currency: s.currency,
        sector: s.sector,
      })),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Analiz üretilemedi.');
  return body.analysis;
}

/**
 * Portföy Yorumu üretici (Vercel sunucu fonksiyonu).
 *
 * Giriş yapan kullanıcının portföyünü alır, Yahoo Finance + Supabase haber
 * verisiyle gerçek skorlar üretir ve TEK Claude çağrısıyla yorum/öneri ekler
 * (server/portfolioAnalysis.js). Sonuç kullanıcının satırına (portfolio_analyses)
 * kaydedilir ve döndürülür — böylece tekrar açılışta AI'sız hızlıca okunur.
 *
 * Gerekli Vercel env: SUPABASE_URL (veya VITE_SUPABASE_URL),
 * SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY (yoksa yorumlar otomatik üretilir).
 */
import { createClient } from '@supabase/supabase-js';
import YahooFinance from 'yahoo-finance2';
import { buildPortfolioAnalysis } from '../server/portfolioAnalysis.js';

export const maxDuration = 60; // analiz birkaç sembol için 10sn'yi aşabilir

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Yöntem desteklenmiyor.' });
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Sunucu yapılandırması eksik.' });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Çağıranı doğrula (AI maliyeti olduğundan yalnızca giriş yapmış kullanıcı)
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Oturum gerekli.' });
  const { data: userData, error: userErr } = await sb.auth.getUser(token);
  if (userErr || !userData.user) return res.status(401).json({ error: 'Geçersiz oturum.' });
  const userId = userData.user.id;

  const holdings = Array.isArray(req.body?.holdings) ? req.body.holdings : [];
  if (holdings.length === 0) return res.status(400).json({ error: 'Portföy boş.' });

  try {
    // Döviz kurları (TRY'ye çevirip ağırlık hesabı için)
    const fx = { USD: 1, EUR: 1 };
    try {
      const rows = await sb.from('fx_rates').select('code, rate');
      for (const r of rows.data ?? []) fx[r.code] = r.rate;
    } catch {
      /* kur yoksa 1 varsayılır */
    }

    const getNewsForSymbol = async (symbol) => {
      const { data } = await sb
        .from('news')
        .select('sentiment, reliability')
        .eq('symbol', symbol)
        .order('published_at', { ascending: false })
        .limit(30);
      return data ?? [];
    };

    const analysis = await buildPortfolioAnalysis(holdings, {
      yahooFinance,
      getNewsForSymbol,
      fx,
      anthropicKey: ANTHROPIC_API_KEY,
    });

    // Kullanıcının satırına kaydet (sonraki açılışta AI'sız okunur)
    await sb
      .from('portfolio_analyses')
      .upsert({ user_id: userId, data: analysis, updated_at: new Date().toISOString() });

    return res.status(200).json({ analysis });
  } catch (err) {
    console.error('[analyze-portfolio]', err.message);
    return res.status(500).json({ error: 'Analiz üretilemedi.' });
  }
}

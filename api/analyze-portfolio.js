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
import { canSpendAi } from '../server/aiControl.js';
import {
  isFreshPortfolioCache,
  normalizeHoldings,
  portfolioFingerprint,
} from '../server/portfolioRequest.js';

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

  let holdings;
  try {
    holdings = normalizeHoldings(req.body?.holdings);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const fingerprint = portfolioFingerprint(holdings);
  const cacheHours = Number(process.env.PORTFOLIO_AI_CACHE_HOURS) || 6;

  try {
    // Aynı portföy için taze sonuç varsa Yahoo/Claude çağrısı yapmadan dön.
    const { data: cachedRow } = await sb
      .from('portfolio_analyses')
      .select('data, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (isFreshPortfolioCache(cachedRow?.data, fingerprint, cacheHours)) {
      return res.status(200).json({ analysis: { ...cachedRow.data, cacheHit: true } });
    }

    // AI atlanırsa SEBEBİNİ taşı. Eskiden bu düşüşler yalnızca sunucu log'una
    // yazılıyordu; kullanıcı "yorumlar neden otomatik?" sorusunun cevabını
    // hiçbir yerde göremiyordu (migration/env eksik mi, kota mı doldu?).
    let aiNotice = null;
    let allowAi = Boolean(ANTHROPIC_API_KEY);
    if (!allowAi) {
      aiNotice = {
        code: 'no_key',
        message: 'ANTHROPIC_API_KEY tanımlı değil — yorumlar AI olmadan üretildi.',
      };
    }

    if (allowAi && !(await canSpendAi({ reserveUsd: 0.02 }))) {
      allowAi = false;
      aiNotice = {
        code: 'budget',
        message: 'Günlük Claude bütçesi doldu — yorumlar AI olmadan üretildi.',
      };
    }

    if (allowAi) {
      const parsedDailyLimit = Number(process.env.PORTFOLIO_AI_DAILY_LIMIT);
      const parsedCooldown = Number(process.env.PORTFOLIO_AI_COOLDOWN_SECONDS);
      const dailyLimit = Math.max(0, Number.isFinite(parsedDailyLimit) ? parsedDailyLimit : 5);
      const cooldown = Math.max(0, Number.isFinite(parsedCooldown) ? parsedCooldown : 300);
      const quota = await sb.rpc('consume_portfolio_ai_quota', {
        p_user_id: userId,
        p_daily_limit: dailyLimit,
        p_cooldown_seconds: cooldown,
      });
      if (quota.error) {
        // Maliyet koruması migration uygulanana kadar güvenli biçimde AI'ı kapatır;
        // deterministik analiz yine üretilir.
        console.error(`[analyze-portfolio] AI kotası okunamadı: ${quota.error.message}`);
        allowAi = false;
        aiNotice = {
          code: 'setup_missing',
          message:
            'AI kota tablosu kurulu değil (supabase/ai-control-schema.sql çalıştırılmamış) — ' +
            'yorumlar AI olmadan üretildi.',
        };
      } else {
        allowAi = quota.data === true;
        if (!allowAi) {
          aiNotice = {
            code: 'quota',
            message: `AI limiti: günde ${dailyLimit} analiz ve analizler arası ${Math.round(cooldown / 60)} dk bekleme. Skorlar güncel, yorumlar AI olmadan üretildi.`,
          };
        }
      }
    }

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
      anthropicKey: allowAi ? ANTHROPIC_API_KEY : null,
    });
    analysis.portfolioFingerprint = fingerprint;
    analysis.cacheHit = false;
    // AI izin verildiği hâlde çağrı içeride hata aldıysa (kredi bitti, ağ vb.)
    // buildPortfolioAnalysis aiUsed=false döner; kullanıcı yine bilgilendirilir.
    if (!aiNotice && allowAi && !analysis.aiUsed) {
      aiNotice = {
        code: 'ai_failed',
        message: 'Claude çağrısı tamamlanamadı (kredi veya bağlantı) — yorumlar AI olmadan üretildi.',
      };
    }
    analysis.aiNotice = aiNotice;

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

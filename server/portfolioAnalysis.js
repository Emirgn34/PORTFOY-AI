/**
 * Portföy Yorumu motoru.
 *
 * Kullanıcının portföyündeki her hisse için Yahoo Finance fiyat/temel verisi ve
 * Supabase'deki haberlerden GERÇEK skorlar üretir (teknik, temel, risk, getiri
 * potansiyeli, haber duyarlılığı). Ardından TEK bir Claude (Haiku 4.5) çağrısıyla
 * portföy geneli yorumu + her hisse için kısa yorum ve öneri üretir (maliyet
 * düşük). ANTHROPIC_API_KEY yoksa yorumlar skorlardan türetilen otomatik
 * cümlelerle doldurulur (graceful).
 *
 * Çıktı, mockAnalysis.js şemasıyla BİREBİR aynıdır; UI bileşenleri değişmeden
 * çalışır.
 */
import Anthropic from '@anthropic-ai/sdk';
import { SECTOR_TR } from './marketData.js';

const MODEL = 'claude-haiku-4-5';
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(n);
const pctAbove = (a, b) => (a && b ? (a / b - 1) * 100 : 0);

function toYahooSymbol(h) {
  const t = String(h.ticker || '').toUpperCase();
  return h.market === 'BIST' ? `${t}.IS` : t;
}

/** Hissenin değerini TRY'ye çevirir (ağırlık hesabı için). */
function valueInTry(h, fx) {
  const price = Number(h.currentPrice) || Number(h.avgPrice) || 0;
  const qty = Number(h.quantity) || 0;
  const raw = price * qty;
  const cur = h.currency || 'TRY';
  if (cur === 'USD') return raw * (fx.USD || 1);
  if (cur === 'EUR') return raw * (fx.EUR || 1);
  return raw;
}

/** quote + quoteSummary + haber özetinden bir hissenin skorlarını üretir. */
function scoreStock(quote, summary, news) {
  const price = quote?.regularMarketPrice ?? null;
  const ma50 = quote?.fiftyDayAverage ?? null;
  const ma200 = quote?.twoHundredDayAverage ?? null;
  const chg = quote?.regularMarketChangePercent ?? 0;
  const high52 = quote?.fiftyTwoWeekHigh ?? null;
  const low52 = quote?.fiftyTwoWeekLow ?? null;

  const detail = summary?.summaryDetail ?? {};
  const fin = summary?.financialData ?? {};
  const stats = summary?.defaultKeyStatistics ?? {};
  const beta = detail.beta ?? stats.beta ?? 1;

  // Teknik (quote'taki MA'lerden — geçmiş grafik çekmeden, hızlı)
  const technicalScore = round(
    clamp(50 + pctAbove(price, ma50) * 2 + pctAbove(price, ma200) * 1 + chg * 1.5)
  );

  // Temel sağlamlık
  const pm = fin.profitMargins ?? null;
  const roe = fin.returnOnEquity ?? null;
  const d2e = fin.debtToEquity ?? null;
  const cr = fin.currentRatio ?? null;
  const fundamentalScore = round(
    clamp(
      50 +
        (pm != null ? pm * 100 * 1.2 : 0) +
        (roe != null ? roe * 100 * 0.8 : 0) -
        (d2e != null ? (d2e / 100) * 15 : 0) +
        (cr != null ? (cr - 1) * 10 : 0)
    )
  );

  // Değerleme + büyüme → getiri potansiyeli
  const pe = detail.trailingPE ?? detail.forwardPE ?? fin.forwardPE ?? null;
  const valuationScore = pe && pe > 0 ? clamp(125 - pe * 2.2) : 50;
  const eg = fin.earningsGrowth ?? null;
  const rg = fin.revenueGrowth ?? null;
  const growthScore = clamp(50 + (eg != null ? eg * 100 * 1.2 : 0) + (rg != null ? rg * 100 * 0.8 : 0));
  const momentum = clamp(50 + pctAbove(price, ma200) * 1.5);
  const returnPotential = round(clamp(growthScore * 0.45 + valuationScore * 0.3 + momentum * 0.25));

  // Risk (beta + 52h aralık genişliği) — yüksek = riskli
  const rangePct = price && high52 && low52 ? ((high52 - low52) / price) * 100 : 50;
  const riskScore = round(clamp((beta - 0.5) * 40 + (rangePct - 30) * 0.8));

  // Haberler
  const newsCount = news?.count ?? 0;
  const reliableNewsAvg = news?.reliabilityAvg ?? 5;
  const newsSensitivity = round(clamp(35 + (beta - 1) * 30 + Math.min(newsCount, 20) * 1.5));

  // Genel skor (temel + teknik + getiri + haber güvenilirliği)
  const overallScore = round(
    clamp(
      fundamentalScore * 0.35 +
        technicalScore * 0.25 +
        returnPotential * 0.25 +
        reliableNewsAvg * 10 * 0.15
    )
  );

  return {
    overallScore,
    riskScore,
    returnPotential,
    newsSensitivity,
    reliableNewsAvg: Number(reliableNewsAvg.toFixed ? reliableNewsAvg.toFixed(1) : reliableNewsAvg),
    fundamentalScore,
    technicalScore,
    sentiment: news?.sentiment ?? 'neutral',
  };
}

function deriveRecommendation(overallScore, riskScore) {
  if (riskScore >= 70) return 'Riskli';
  if (overallScore >= 75) return 'Güçlü';
  if (overallScore >= 55) return 'İzlenmeli';
  return 'Nötr';
}

function riskLevelFromScore(s) {
  return s >= 60 ? 'Yüksek' : s >= 38 ? 'Orta' : 'Düşük';
}

const AI_SCHEMA = {
  type: 'object',
  properties: {
    portfolio_comment: { type: 'string' },
    stocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ticker: { type: 'string' },
          recommendation: { type: 'string', enum: ['Güçlü', 'İzlenmeli', 'Nötr', 'Riskli'] },
          comment: { type: 'string' },
        },
        required: ['ticker', 'recommendation', 'comment'],
        additionalProperties: false,
      },
    },
  },
  required: ['portfolio_comment', 'stocks'],
  additionalProperties: false,
};

const SYSTEM_PROMPT =
  'Sen deneyimli bir portföy analistisin. Sana bir yatırımcının portföyü ve her ' +
  'hisse için hesaplanmış GERÇEK skorlar (temel, teknik, risk, getiri potansiyeli, ' +
  'haber güvenilirliği, sektör, ağırlık) verilecek. Görevin:\n' +
  '- portfolio_comment: Portföyün geneli için 2-4 cümlelik Türkçe yorum — ' +
  'çeşitlendirme/yoğunlaşma riski, sektör dağılımı, genel risk-getiri dengesi ve ' +
  'somut bir öneri içersin.\n' +
  '- her hisse için: recommendation (Güçlü/İzlenmeli/Nötr/Riskli — verilen skorlarla ' +
  'tutarlı olsun) ve comment (o hisseye özgü, skorlara dayanan 1-2 cümlelik Türkçe ' +
  'yorum; neden güçlü/zayıf olduğunu açıkla).\n' +
  'Yalnızca verilen verilere dayan, uydurma. Yatırım tavsiyesi dili kullanma; ' +
  'veri odaklı ve nesnel ol.';

/** Skorları okunaklı otomatik yoruma çevirir (AI yoksa). */
function autoComment(ticker, s) {
  const güç = s.overallScore >= 70 ? 'güçlü' : s.overallScore >= 50 ? 'dengeli' : 'zayıf';
  return (
    `${ticker} için genel görünüm ${güç} (skor ${s.overallScore}/100). Temel sağlamlık ` +
    `${s.fundamentalScore}, teknik ${s.technicalScore}, getiri potansiyeli ${s.returnPotential}, ` +
    `risk ${s.riskScore}. (AI yorumu için ANTHROPIC_API_KEY tanımlanmalı.)`
  );
}

/**
 * Portföyü analiz eder.
 * deps: { yahooFinance, getNewsForSymbol(symbol)->Promise<rows>, fx:{USD,EUR}, anthropicKey }
 * Dönüş: { generatedAt, portfolio:{...}, stocks:{ TICKER:{...} } } (mock şemasıyla aynı).
 */
export async function buildPortfolioAnalysis(holdings, deps) {
  const { yahooFinance, getNewsForSymbol, fx = { USD: 1, EUR: 1 }, anthropicKey } = deps;
  const symbols = holdings.map(toYahooSymbol);

  // Fiyatlar tek toplu çağrı
  const quoteMap = new Map();
  try {
    const quotes = await yahooFinance.quote(symbols);
    for (const q of Array.isArray(quotes) ? quotes : [quotes]) quoteMap.set(q.symbol, q);
  } catch (err) {
    console.error(`[analysis] toplu fiyat hatası: ${err.message}`);
  }

  // Her hisse için temel veri + haber (paralel)
  const perStock = await Promise.all(
    holdings.map(async (h) => {
      const symbol = toYahooSymbol(h);
      const quote = quoteMap.get(symbol) ?? null;
      let summary = null;
      try {
        summary = await yahooFinance.quoteSummary(symbol, {
          modules: ['summaryDetail', 'financialData', 'defaultKeyStatistics', 'assetProfile'],
        });
      } catch {
        summary = null;
      }
      let news = null;
      try {
        const rows = (await getNewsForSymbol(symbol)) ?? [];
        if (rows.length) {
          const rels = rows.map((r) => (Number.isFinite(r.reliability) ? r.reliability : 5));
          const pos = rows.filter((r) => r.sentiment === 'positive').length;
          const neg = rows.filter((r) => r.sentiment === 'negative').length;
          news = {
            count: rows.length,
            reliabilityAvg: rels.reduce((a, b) => a + b, 0) / rels.length,
            sentiment: pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral',
          };
        }
      } catch {
        news = null;
      }
      const scores = scoreStock(quote, summary, news);
      const sector = SECTOR_TR[summary?.assetProfile?.sector] ?? h.sector ?? 'Diğer';
      return { holding: h, scores, sector, valueTry: valueInTry({ ...h, currentPrice: quote?.regularMarketPrice ?? h.currentPrice }, fx) };
    })
  );

  const totalValue = perStock.reduce((s, p) => s + p.valueTry, 0) || 1;
  const w = (p) => p.valueTry / totalValue;

  // Portföy geneli ağırlıklı skorlar
  const fundamentalScore = round(perStock.reduce((s, p) => s + p.scores.fundamentalScore * w(p), 0));
  const technicalScore = round(perStock.reduce((s, p) => s + p.scores.technicalScore * w(p), 0));
  const newsImpactScore = round(perStock.reduce((s, p) => s + p.scores.reliableNewsAvg * 10 * w(p), 0));
  const weightedRisk = perStock.reduce((s, p) => s + p.scores.riskScore * w(p), 0);
  const weightedReturn = perStock.reduce((s, p) => s + p.scores.returnPotential * w(p), 0);

  // Çeşitlendirme: sektör yoğunlaşması (HHI) + hisse sayısı
  const sectorWeights = {};
  for (const p of perStock) sectorWeights[p.sector] = (sectorWeights[p.sector] || 0) + w(p);
  const hhi = Object.values(sectorWeights).reduce((s, x) => s + x * x, 0);
  const countBonus = Math.min(perStock.length, 8) / 8; // çok hisse = daha iyi
  const diversificationScore = round(clamp((1 - hhi) * 90 + countBonus * 15));

  const overallScore = round(
    clamp(fundamentalScore * 0.3 + technicalScore * 0.2 + weightedReturn * 0.25 + diversificationScore * 0.1 + newsImpactScore * 0.15)
  );
  const riskLevel = riskLevelFromScore(weightedRisk);

  // --- Tek Claude çağrısı (portföy + hisse yorumları) ---
  let aiPortfolioComment = null;
  const aiByTicker = new Map();
  if (anthropicKey) {
    try {
      const client = new Anthropic({ apiKey: anthropicKey });
      const lines = perStock.map((p) => {
        const s = p.scores;
        return `- ${p.holding.ticker} (${p.holding.company ?? ''}, ${p.sector}, ağırlık %${(w(p) * 100).toFixed(1)}): genel ${s.overallScore}, temel ${s.fundamentalScore}, teknik ${s.technicalScore}, getiri ${s.returnPotential}, risk ${s.riskScore}, haber güvenilirliği ${s.reliableNewsAvg}/10, haber tonu ${s.sentiment}`;
      });
      const userPrompt =
        `Portföy geneli: genel skor ${overallScore}/100, çeşitlendirme ${diversificationScore}, ` +
        `risk seviyesi ${riskLevel}, temel ${fundamentalScore}, teknik ${technicalScore}, ` +
        `haber etkisi ${newsImpactScore}. Sektör dağılımı: ` +
        Object.entries(sectorWeights).map(([k, v]) => `${k} %${(v * 100).toFixed(0)}`).join(', ') +
        `.\n\nHisseler:\n${lines.join('\n')}\n\nHer ticker için yorum+öneri ve portföy geneli yorumu üret.`;

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        output_config: { format: { type: 'json_schema', schema: AI_SCHEMA } },
      });
      const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';
      const parsed = JSON.parse(text);
      aiPortfolioComment = parsed.portfolio_comment ?? null;
      for (const r of parsed.stocks ?? []) {
        if (r?.ticker) aiByTicker.set(String(r.ticker).toUpperCase(), r);
      }
    } catch (err) {
      console.error(`[analysis] AI hatası: ${err.message}`);
    }
  }

  // --- Çıktıyı mock şemasına göre derle ---
  const stocks = {};
  for (const p of perStock) {
    const t = p.holding.ticker.toUpperCase();
    const ai = aiByTicker.get(t);
    const s = p.scores;
    stocks[t] = {
      overallScore: s.overallScore,
      riskScore: s.riskScore,
      returnPotential: s.returnPotential,
      newsSensitivity: s.newsSensitivity,
      reliableNewsAvg: s.reliableNewsAvg,
      recommendation: ai?.recommendation ?? deriveRecommendation(s.overallScore, s.riskScore),
      comment: ai?.comment ?? autoComment(t, s),
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    aiUsed: Boolean(anthropicKey && aiPortfolioComment),
    portfolio: {
      overallScore,
      riskLevel,
      diversificationScore,
      newsImpactScore,
      fundamentalScore,
      technicalScore,
      comment:
        aiPortfolioComment ??
        `Portföy genel skoru ${overallScore}/100, risk seviyesi ${riskLevel}. Çeşitlendirme ${diversificationScore}/100. (Detaylı AI yorumu için ANTHROPIC_API_KEY tanımlanmalı.)`,
    },
    stocks,
  };
}

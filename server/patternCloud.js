/**
 * Desen taramasının BULUT yolu — dakikalık haber cron'una biner.
 *
 * Trade worker (PC) kapalıyken de "tekrarlayan düşüş" bildirimleri gitsin diye
 * aynı tarama, Supabase Cron → Vercel haber turunun SONUNA eklenir. Bayatlık
 * süreç içi önbellekten DEĞİL trade_context.data.patternStats.updatedAt
 * alanından okunur: sunucusuz ortamda süreç hafızasına güvenilmez.
 *
 * Maliyet tavanı: tur başına en çok CLOUD_PATTERN_BATCH sembol chart isteği;
 * 50 sembollük evren 6 saatlik tazelikle dakikada ortalama ~0,14 chart çağrısı
 * demektir (çoğu tur sıfır). Worker ile çakışma zararsızdır: bölüm kimliği
 * aynı olduğu için bildirim yine TEK kez üretilir (ignoreDuplicates).
 */
import YahooFinance from 'yahoo-finance2';
import { checked } from './automationDb.js';
import { candidateTradeSymbol } from './tradeData.js';
import { deliverNotifications } from './pushNotifications.js';
import {
  PATTERN_RESCAN_MS, buildDipAlertEvent, summarizeDipPattern, toDailyBars,
} from './patternStats.js';

export const CLOUD_PATTERN_BATCH = 4;

const defaultYahoo = () => new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export async function scanCloudPatterns(sb, {
  yahoo = defaultYahoo(), now = Date.now(), limit = CLOUD_PATTERN_BATCH, deliver = deliverNotifications,
} = {}) {
  // ABD trade evreni (worker'daki sıralamanın aynısı; BIST desen taramasına girmez)
  const [tracked, candidates] = await Promise.all([
    sb.from('tracked_symbol_queue').select('symbol').order('symbol').limit(100),
    sb.from('candidates').select('symbol,market').eq('horizon', 'short').order('updated_at', { ascending: false }).limit(100),
  ]);
  const universe = [...new Set([
    ...(checked(tracked) ?? []).map((row) => row.symbol),
    ...(checked(candidates) ?? []).map(candidateTradeSymbol),
  ])].filter((symbol) => /^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) && !symbol.endsWith('.IS')).slice(0, 50);
  if (!universe.length) return { scanned: 0, alerts: 0 };

  const contexts = checked(await sb.from('trade_context').select('symbol,data').in('symbol', universe)) ?? [];
  const byContext = new Map(contexts.map((row) => [row.symbol, row]));
  const due = universe
    .map((symbol) => ({
      symbol,
      updatedAt: Date.parse(byContext.get(symbol)?.data?.patternStats?.updatedAt ?? '') || 0,
    }))
    .filter((item) => now - item.updatedAt >= PATTERN_RESCAN_MS)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, limit);

  const alerts = [];
  let scanned = 0;
  for (const { symbol } of due) {
    try {
      const chart = await yahoo.chart(symbol, { period1: new Date(now - 2 * 365 * 86_400_000), interval: '1d' });
      const summary = summarizeDipPattern(toDailyBars(chart), { now: new Date(now) });
      if (!summary) continue;
      scanned++;
      // Mevcut bağlam alanları (makro/istihbarat) korunarak yalnız desen alanı
      // yenilenir. Worker aynı anda yazarsa kaybolan alanları bir sonraki tur
      // onarır — kişisel kurulumda kabul edilen küçük bir yarış.
      const existing = byContext.get(symbol)?.data ?? {};
      checked(await sb.from('trade_context').upsert([{
        symbol, updated_at: new Date(now).toISOString(), data: { ...existing, patternStats: summary },
      }]));
      const alert = buildDipAlertEvent({
        symbol, name: existing.intelligence?.name ?? symbol,
        stats: summary.stats, state: summary.state, now: new Date(now),
      });
      if (alert) alerts.push(alert);
    } catch {
      // Tek sembolün veri hatası turu durdurmaz; sembol sonraki turda yeniden denenir.
    }
  }
  if (alerts.length) {
    checked(await sb.from('notification_events').upsert(alerts, { onConflict: 'id', ignoreDuplicates: true }));
    // Haber turunun kendi teslimi bizden ÖNCE koştu; yeni desen olayları için
    // hedefli tek teslim yeterli.
    await deliver(sb, { topics: ['pattern'] });
  }
  return { scanned, alerts: alerts.length };
}

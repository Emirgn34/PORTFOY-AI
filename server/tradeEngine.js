/** Intraday rule engine. Scores rank setups; they are not win probabilities.
 * Only verified, recent, licensed-feed snapshots may become actionable.
 * Bar `time` denotes the OPEN of a completed one-minute regular-session bar.
 */
import { createHash } from 'node:crypto';

const MINUTE = 60_000;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const positive = (v) => finite(v) && v > 0;
const round = (v, digits = 4) => Number(v.toFixed(digits));
const average = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const timestamp = (v) => typeof v === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(v) ? Date.parse(v) : NaN;
const iso = (v) => Number.isFinite(v) ? new Date(v).toISOString() : null;
const unique = (values) => [...new Set(values)];

function ema(values, period) {
  return values.reduce((previous, value) => previous == null ? value : value * (2 / (period + 1)) + previous * (1 - 2 / (period + 1)), null);
}

function rsi(values, period = 14) {
  let gain = 0, loss = 0;
  for (let index = 1; index <= period; index++) {
    const change = values[index] - values[index - 1];
    gain += Math.max(0, change); loss += Math.max(0, -change);
  }
  gain /= period; loss /= period;
  for (let index = period + 1; index < values.length; index++) {
    const change = values[index] - values[index - 1];
    gain = (gain * (period - 1) + Math.max(0, change)) / period;
    loss = (loss * (period - 1) + Math.max(0, -change)) / period;
  }
  return gain === 0 && loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

function validBar(bar) {
  return Number.isFinite(timestamp(bar?.time)) && ['open', 'high', 'low', 'close'].every((key) => positive(bar[key]))
    && finite(bar.volume) && bar.volume >= 0 && bar.high >= Math.max(bar.open, bar.close)
    && bar.low <= Math.min(bar.open, bar.close) && bar.high >= bar.low;
}

/** Quote expiry is rechecked on reads and immediately before a notification. */
export function isTradeCandidateFresh(candidate, now = Date.now()) {
  const clock = now instanceof Date ? now.getTime() : now;
  const quality = candidate?.dataQuality;
  const quoteTime = timestamp(quality?.quoteTime);
  const barTime = timestamp(quality?.barTime);
  const created = timestamp(candidate?.createdAt);
  return candidate?.status === 'ready' && quality?.realtime === true
    && quality?.sessionVerified === true && quality?.halted === false
    && Number.isFinite(clock) && timestamp(candidate.expiresAt) > clock
    && created <= clock + 2000 && clock - created <= 30_000
    && quoteTime <= clock + 2000 && clock - quoteTime <= 15_000
    && barTime <= clock && clock - barTime <= 90_000;
}

export function buildTradeCandidate({ symbol, quote = {}, bars = [], context = {} } = {}, {
  now = Date.now(), maxQuoteAgeMs = 15_000, maxBarAgeMs = 90_000, roundTripCostBps = 20,
} = {}) {
  const clock = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(clock)) throw new Error('Geçerli değerlendirme zamanı gerekli.');
  // Caller options may tighten live-data guards, never loosen them.
  maxQuoteAgeMs = Math.min(15_000, positive(maxQuoteAgeMs) ? maxQuoteAgeMs : 15_000);
  maxBarAgeMs = Math.min(90_000, positive(maxBarAgeMs) ? maxBarAgeMs : 90_000);
  roundTripCostBps = finite(roundTripCostBps) && roundTripCostBps >= 0 ? roundTripCostBps : 20;
  const blockers = [], warnings = [], reasons = [];
  const symbolValid = typeof symbol === 'string' && /^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol);
  if (!symbolValid) blockers.push('Geçerli hisse sembolü eksik.');
  const bist = symbolValid && symbol.endsWith('.IS');
  const currency = bist ? 'TRY' : 'USD';
  if (quote.currency !== currency) blockers.push('Fiyat para birimi doğrulanamadı.');
  const qt = timestamp(quote.marketTime), rt = timestamp(quote.receivedAt), sessionEnd = timestamp(quote.sessionEndsAt);
  const quoteAgeMs = Number.isFinite(qt) ? clock - qt : null;
  if (!Number.isFinite(qt) || clock - qt > maxQuoteAgeMs || qt > clock + 2000) blockers.push('Fiyat zaman damgası eksik, eski veya gelecekte.');
  if (!Number.isFinite(rt) || rt < qt - 2000 || rt > clock + 2000 || clock - rt > maxQuoteAgeMs) blockers.push('Verinin sunucuya geliş zamanı doğrulanamadı.');
  if (quote.realtime !== true || typeof quote.source !== 'string' || !quote.source.trim()) blockers.push('Lisanslı gerçek zamanlı fiyat akışı doğrulanmadı.');
  if (quote.barIntervalSeconds !== 60) blockers.push('Bir dakikalık bar aralığı doğrulanmadı.');
  if (quote.sessionVerified !== true || quote.marketState !== 'REGULAR') blockers.push('Sürekli işlem seansı doğrulanmadı.');
  if (quote.halted !== false) blockers.push('İşlem durdurma / devre kesici durumu doğrulanmadı veya işlem durduruldu.');
  if (!Number.isFinite(sessionEnd) || sessionEnd - clock < 30 * MINUTE || sessionEnd - clock > 9 * 60 * MINUTE) blockers.push('Seans kapanışı doğrulanmadı veya yeni işlem için 30 dakikadan az kaldı.');
  if (!positive(quote.price) || !positive(quote.bid) || !positive(quote.ask) || quote.ask < quote.bid) blockers.push('Geçerli son fiyat ve alış/satış kotasyonu eksik.');
  const entry = positive(quote.ask) ? quote.ask : null;
  const spreadBps = positive(quote.bid) && positive(quote.ask) && quote.ask >= quote.bid ? (quote.ask - quote.bid) / ((quote.ask + quote.bid) / 2) * 10_000 : null;
  if (spreadBps != null && spreadBps > 25) blockers.push('Alış/satış farkı 25 baz puan sınırının üzerinde.');
  if (entry && positive(quote.price) && Math.abs(quote.price / entry - 1) > 0.005) blockers.push('Son işlem fiyatı ile kotasyon arasında tutarsızlık var.');

  const inputBars = Array.isArray(bars) ? bars.slice(-500) : [];
  const malformed = inputBars.some((bar) => !validBar(bar));
  if (malformed) blockers.push('Dakikalık OHLCV verisinde geçersiz değer var.');
  const ordered = inputBars.filter(validBar).sort((a, b) => timestamp(a.time) - timestamp(b.time));
  if (ordered.some((bar, i) => i > 0 && timestamp(bar.time) === timestamp(ordered[i - 1].time))) blockers.push('Dakikalık barlarda yinelenen zaman damgası var.');
  // Unfinished bars are never used, including extreme intrabar prices/volumes.
  const completed = ordered.filter((bar) => timestamp(bar.time) + MINUTE <= clock);
  const barClose = completed.length ? timestamp(completed.at(-1).time) + MINUTE : NaN;
  const barAgeMs = Number.isFinite(barClose) ? clock - barClose : null;
  if (!Number.isFinite(barClose) || clock - barClose > maxBarAgeMs) blockers.push('Tamamlanmış güncel bir dakikalık bar yok.');
  // Restrict indicators to a contiguous current session. No overnight VWAP.
  let start = completed.length - 1;
  while (start > 0 && timestamp(completed[start].time) - timestamp(completed[start - 1].time) === MINUTE) start--;
  const sessionBars = completed.slice(Math.max(0, start));
  const sessionStart = timestamp(quote.sessionStartsAt);
  const usable = Number.isFinite(sessionStart) ? sessionBars.filter((bar) => timestamp(bar.time) >= sessionStart) : sessionBars;
  if (!Number.isFinite(sessionStart) || sessionStart % MINUTE !== 0 || sessionStart > clock || sessionStart >= sessionEnd) blockers.push('Seans başlangıcı doğrulanmadı; seans VWAP hesaplanamaz.');
  if (usable.length < 40) blockers.push('Aynı seansta kesintisiz en az 40 tamamlanmış dakikalık bar gerekli.');
  const volume = usable.reduce((sum, bar) => sum + bar.volume, 0);
  if (volume <= 0) blockers.push('İşlem hacmi bulunamadı.');
  // VWAP must include all completed bars from regular-session open.
  if (Number.isFinite(sessionStart) && usable.length && timestamp(usable[0].time) !== sessionStart) blockers.push('Seans başından itibaren bar kapsamı eksik; VWAP doğrulanamadı.');
  if (usable.some((bar) => timestamp(bar.time) % MINUTE !== 0)) blockers.push('Dakikalık barlar dakika başlangıçlarına hizalı değil.');

  let metrics = { spreadBps: spreadBps == null ? null : round(spreadBps, 2), roundTripCostBps }, scenarios = [], stopLoss = null, score = 0;
  if (usable.length >= 40 && entry && volume > 0) {
    const closes = usable.map((bar) => bar.close);
    const vwap = usable.reduce((sum, bar) => sum + (bar.high + bar.low + bar.close) / 3 * bar.volume, 0) / volume;
    const ema9 = ema(closes, 9), ema21 = ema(closes, 21), strength = rsi(closes);
    const tr = usable.slice(1).map((bar, i) => Math.max(bar.high - bar.low, Math.abs(bar.high - usable[i].close), Math.abs(bar.low - usable[i].close)));
    const atr = average(tr.slice(-14));
    const atrPercent = atr / entry * 100;
    const recent = usable.slice(-3), baseline = usable.slice(-33, -3);
    const baseVolume = average(baseline.map((bar) => bar.volume));
    const relativeVolume = baseVolume > 0 ? average(recent.map((bar) => bar.volume)) / baseVolume : 0;
    const minuteNotional = average(usable.slice(-20).map((bar) => bar.close * bar.volume));
    const momentumPercent = (closes.at(-1) / closes.at(-6) - 1) * 100;
    const trend = ema9 > ema21 && closes.at(-1) > ema9;
    const aboveVwap = quote.price >= vwap;
    const notExtended = entry / vwap <= 1.03;
    const liquid = minuteNotional >= (bist ? 1_000_000 : 100_000);
    score = (trend ? 25 : 0) + (aboveVwap && notExtended ? 20 : 0)
      + (strength >= 45 && strength <= 75 ? 15 : 0) + (relativeVolume >= 1.2 ? 15 : relativeVolume >= 1 ? 8 : 0)
      + (momentumPercent > 0 ? 10 : 0) + (liquid ? 10 : 0) + (spreadBps != null && spreadBps <= 15 ? 5 : 0);
    if (trend) reasons.push('Dakikalık EMA9, EMA21 üzerinde; son kapanış kısa trendi teyit ediyor.');
    if (aboveVwap && notExtended) reasons.push(`Fiyat seans VWAP (${round(vwap)}) üzerinde; ortalamadan uzaklık %${round((entry / vwap - 1) * 100, 2)}.`);
    if (relativeVolume >= 1.2) reasons.push(`Son 3 dakikanın hacmi önceki 30 dakikanın ${round(relativeVolume, 2)} katı.`);
    if (strength >= 45 && strength <= 75) reasons.push(`RSI(14) ${round(strength, 1)}; momentum aşırı alım sınırını aşmıyor.`);
    if (!liquid) blockers.push('Son 20 dakikanın ortalama işlem tutarı likidite eşiğinin altında.');
    if (!notExtended) blockers.push('Fiyat VWAP üzerinde %3 sınırını aşmış; hareketi kovalamama filtresi.');
    if (!(atr > 0)) blockers.push('Volatilite ve zarar kes mesafesi hesaplanamadı.');
    const stopDistance = Math.max(atr * 1.5, entry - Math.min(...usable.slice(-5).map((bar) => bar.low)), entry * 0.004);
    const stopPercent = stopDistance / entry * 100;
    stopLoss = round(entry - stopDistance);
    if (stopPercent > 3) blockers.push('Gerekli zarar kes mesafesi %3 sınırını aşıyor.');
    const estimatedCostPerShare = entry * (roundTripCostBps + (spreadBps ?? 0)) / 10_000;
    const availableHours = Number.isFinite(sessionEnd) ? (sessionEnd - clock) / 3_600_000 : 0;
    // Volatility-distance heuristic only. No calibrated first-passage forecast.
    scenarios = [
      { id: 'near', label: 'Görece temkinli hedef', risk: 'lower', multiple: 2, floor: 1 },
      { id: 'balanced', label: 'Dengeli hedef', risk: 'medium', multiple: 3, floor: 2 },
      { id: 'extended', label: 'Agresif hedef', risk: 'high', multiple: 4, floor: 3 },
    ].map(({ id, label, risk, multiple, floor }) => {
      const targetDistance = Math.max(stopDistance * multiple, entry * floor / 100, 1.6 * (stopDistance + estimatedCostPerShare) + estimatedCostPerShare);
      const targetPercent = round(targetDistance / entry * 100, 2);
      const netRewardRisk = (targetDistance - estimatedCostPerShare) / (stopDistance + estimatedCostPerShare);
      const centralHours = atr > 0 ? (targetDistance / atr) ** 2 / 60 : Infinity;
      const minHours = Math.max(0.5, Math.floor(centralHours * 0.5 * 2) / 2);
      const maxHours = Math.max(minHours + 0.5, Math.ceil(centralHours * 1.5 * 2) / 2);
      const eligible = netRewardRisk >= 1.5 && maxHours <= availableHours && maxHours <= 6;
      return { id, label, risk, targetPercent, targetPrice: round(entry + targetDistance), stopLoss,
        netRewardRisk: round(netRewardRisk, 2), estimatedHours: Number.isFinite(maxHours) ? [minHours, maxHours] : null,
        eligible, ineligibleReason: eligible ? null : netRewardRisk < 1.5 ? 'Maliyet sonrası getiri/risk 1,5 altında.' : 'Hedef penceresi kalan seansı veya 6 saati aşıyor.' };
    });
    metrics = { ...metrics, ema9: round(ema9), ema21: round(ema21), vwap: round(vwap), rsi14: round(strength, 1),
      atr14: round(atr), atrPercent: round(atrPercent, 2), relativeVolume: round(relativeVolume, 2), minuteNotional: round(minuteNotional, 2),
      momentumPercent: round(momentumPercent, 2), stopPercent: round(stopPercent, 2), estimatedCostPerShare: round(estimatedCostPerShare),
      barsUsed: usable.length, trendConfirmed: trend, aboveVwap, availableHours: round(Math.max(0, availableHours), 2),
      durationMethod: 'Volatiliteye dayalı kalibre edilmemiş işlem penceresi; doğrulanmış varış süresi tahmini değildir.' };
    if (!scenarios.some((scenario) => scenario.eligible)) blockers.push('Maliyet ve kalan seans sonrası uygun hedef senaryosu yok.');
  }

  const news = (Array.isArray(context.news) ? context.news : []).filter((item) => {
    const time = timestamp(item.publishedAt ?? item.published_at);
    return time <= clock && clock - time <= 24 * 60 * MINUTE;
  }).slice(0, 5).map((item) => ({ title: String(item.titleTr ?? item.title_tr ?? item.title ?? '').slice(0, 500),
    url: typeof (item.url ?? item.link) === 'string' && /^https:\/\//.test(item.url ?? item.link) ? item.url ?? item.link : null,
    publisher: String(item.publisher ?? '').slice(0, 120), publishedAt: item.publishedAt ?? item.published_at }));
  if (news.length) warnings.push(`${news.length} güncel şirket haberi bağlama eklendi; başlık tek başına alım sinyali sayılmaz.`);
  if (!news.length) warnings.push('Son 24 saatte doğrulanmış haber bağlamı yok.');
  const earningsValue = context.intelligence?.earningsDate ?? context.intelligence?.earnings?.date ?? context.candidate?.earningsDate;
  // Date-only disclosures have no reliable release time; block the entire day.
  const earningsDay = typeof earningsValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(earningsValue) ? Date.parse(`${earningsValue}T00:00:00Z`) : NaN;
  const earnings = timestamp(earningsValue);
  if (Number.isFinite(earnings) && earnings >= clock - 15 * MINUTE && earnings <= clock + 24 * 60 * MINUTE) blockers.push('Yakın bilanço açıklaması nedeniyle yeni trade sinyali durduruldu.');
  if (Number.isFinite(earningsDay) && earningsDay <= clock + 24 * 60 * MINUTE && earningsDay + 24 * 60 * MINUTE > clock) blockers.push('Bilanço günü / açıklama saati belirsiz; yeni trade sinyali durduruldu.');
  const events = (Array.isArray(context.macroEvents) ? context.macroEvents : []).filter((event) => {
    const time = timestamp(event.time ?? event.date ?? event.startsAt);
    return ['high', 'critical'].includes(event.impact ?? event.importance) && Math.abs(time - clock) <= 30 * MINUTE;
  });
  if (events.length) blockers.push('Yüksek etkili makro veri penceresinde yeni sinyal durduruldu.');
  warnings.push('İşlem pencereleri ve skor geçmiş testle kalibre edilmedi; skor başarı olasılığı değildir.');
  warnings.push('Yakın hedef, sermaye kaybı riskinin düşük olduğu anlamına gelmez. Zarar kes fiyatı gerçekleşme garantisi vermez.');
  if (!Number.isFinite(earnings) && !Number.isFinite(earningsDay)) warnings.push('Bilanço takvimi kapsamı eksik; sağlayıcı takvimi ayrıca doğrulanmalı.');
  if (context.macroCoverage?.verified !== true) warnings.push('Makro takvim kapsamı tam olarak doğrulanmadı; takvimde olay bulunmaması olay olmadığı anlamına gelmez.');
  warnings.push('Komisyon ve kayma varsayımıdır; aracı kurum maliyetleri ve gerçekleşen kayma farklı olabilir.');
  const status = blockers.length ? 'blocked' : score >= 70 && metrics.trendConfirmed && metrics.aboveVwap && metrics.relativeVolume >= 1.2 ? 'ready' : 'watch';
  if (status === 'watch') reasons.push('Yön / hacim teyidi henüz yeterli değil; izleme aşamasında.');
  const expiry = Math.min(clock + 30_000, Number.isFinite(qt) ? qt + maxQuoteAgeMs : clock, Number.isFinite(barClose) ? barClose + maxBarAgeMs : clock);
  const id = createHash('sha256').update(`${symbol}|${iso(barClose)}|long-v1`).digest('hex').slice(0, 24);
  const activeScenario = scenarios.find((scenario) => scenario.eligible);
  return { id, symbol: symbolValid ? symbol : '', name: String(quote.name ?? quote.shortName ?? context.candidate?.companyName ?? symbol ?? '').slice(0, 120), currency,
    market: bist ? 'BIST' : 'ABD', direction: 'long', status, score, entry: entry ? round(entry) : null, stopLoss,
    scenarios, estimatedHours: activeScenario?.estimatedHours ?? null, reasons, blockers: unique(blockers), warnings: unique(warnings), metrics,
    dataQuality: { quoteTime: iso(qt), receivedAt: iso(rt), barTime: iso(barClose), quoteAgeMs, barAgeMs,
      source: String(quote.source ?? '').slice(0, 100), realtime: quote.realtime === true, sessionVerified: quote.sessionVerified === true,
      halted: quote.halted, sessionStartsAt: iso(sessionStart), sessionEndsAt: iso(sessionEnd), transportLatencyMs: Number.isFinite(rt) && Number.isFinite(qt) ? rt - qt : null },
    createdAt: iso(clock), expiresAt: iso(expiry),
    context: { news, candidate: context.candidate ? { score: context.candidate.score ?? context.candidate.shortTermScore ?? null,
      horizon: context.candidate.horizon ?? null, updatedAt: context.candidate.updatedAt ?? null,
      companyName: context.candidate.companyName ?? null, sector: context.candidate.sector ?? null,
      riskLevel: context.candidate.riskLevel ?? null, liquidityLevel: context.candidate.liquidityLevel ?? null,
      convictionScore: context.candidate.conviction?.score ?? null, fundamentals: context.candidate.fundamentals ?? null,
      catalystTitle: context.candidate.strongestCatalystTitle ?? null, catalystDate: context.candidate.catalystDate ?? null,
    } : null,
      intelligence: context.intelligence ?? null, macroEvents: events },
  };
}

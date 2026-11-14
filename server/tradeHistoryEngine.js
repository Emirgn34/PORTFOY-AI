/**
 * Forward-only, simulated trade observations. This module never submits orders.
 * Candle times are the OPEN of complete one-minute candles. We keep a frozen
 * plan, use no pre-publication candle for a new limit entry, and never guess an
 * intrabar path. Licensed quote-reference entries are explicitly hypothetical;
 * a threshold touched anywhere in their first partial candle is ambiguous.
 */
import { createHash } from 'node:crypto';
import { isTradeCandidateFresh } from './tradeEngine.js';

const MINUTE = 60_000;
// Delayed quotes plus the bounded cloud rotation must have time to backfill.
const GRACE = 30 * MINUTE;
const TERMINAL = new Set(['target', 'stop', 'expired', 'ambiguous', 'unresolved']);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const time = (value) => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const clockOf = (value) => value instanceof Date ? value.getTime() : value;
const iso = (value) => Number.isFinite(value) ? new Date(value).toISOString() : null;
const round = (value) => finite(value) ? Number(value.toFixed(6)) : null;
const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 32);

function validBar(bar) {
  const at = time(bar?.time);
  return Number.isFinite(at) && at % MINUTE === 0 && ['open', 'high', 'low', 'close'].every((key) => positive(bar[key]))
    && bar.high >= Math.max(bar.open, bar.close, bar.low) && bar.low <= Math.min(bar.open, bar.close, bar.high)
    && bar.closed !== false && bar.complete !== false && bar.isClosed !== false;
}

function orderedPlan(direction, entry, stop, targets) {
  return ['long', 'short'].includes(direction) && positive(entry) && positive(stop) && targets.length > 0
    && (direction === 'long' ? stop < entry : stop > entry)
    && targets.every((target) => positive(target.targetPrice) && (direction === 'long' ? target.targetPrice > entry : target.targetPrice < entry));
}

function anchorKey(anchors) {
  if (!anchors || typeof anchors !== 'object') return null;
  const values = Object.keys(anchors).sort().map((key) => {
    const anchor = anchors[key];
    return anchor && Number.isFinite(time(anchor.time)) && positive(anchor.price)
      ? `${key}:${anchor.time}:${anchor.price}` : null;
  });
  return values.length && values.every(Boolean) ? values.join('|') : null;
}

/** At most one core plan per symbol/source/mode/session; video plans use their
 * observable pivot anchors. Changing minute IDs or drifting channel projections
 * must never inflate the number of observations or rewrite an existing plan.
 */
export function buildTradeHistoryPlans(candidate, snapshot = {}, { now = Date.now() } = {}) {
  const clock = clockOf(now), q = snapshot.quote ?? {}, quality = candidate?.dataQuality ?? {};
  if (!Number.isFinite(clock) || !candidate || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(candidate.symbol ?? '')
    || snapshot.symbol !== candidate.symbol || !['USD', 'TRY', 'EUR', 'GBP'].includes(candidate.currency)) return [];
  if (q.currency !== candidate.currency) return [];
  const quoteAt = time(q.marketTime), barAt = time(quality.barTime);
  const observationMaxAge = q.realtime === true ? 5 * MINUTE : 30 * MINUTE;
  if (!Number.isFinite(quoteAt) || quoteAt > clock + 2000 || clock - quoteAt > observationMaxAge
    || !Number.isFinite(barAt) || barAt > clock || clock - barAt > observationMaxAge) return [];
  const liveSource = q.realtime === true && q.sessionVerified === true && q.halted === false && quality.realtime === true;
  const mode = liveSource ? 'live' : q.realtime !== true && candidate.availability === 'delayed-research' ? 'research' : null;
  const source = String(q.source ?? quality.source ?? '').slice(0, 100);
  if (!mode || !source) return [];
  const sessionStart = time(q.sessionStartsAt ?? quality.sessionStartsAt), sessionEnd = time(q.sessionEndsAt ?? quality.sessionEndsAt);
  // Old last-session cards remain research context; do not create new trades
  // from them after their observed session has ended.
  if ((Number.isFinite(sessionStart) && clock < sessionStart) || (Number.isFinite(sessionEnd) && clock >= sessionEnd)) return [];
  const rawEnd = Number.isFinite(sessionEnd) && sessionEnd > clock && sessionEnd - clock <= 9 * 60 * MINUTE
    ? sessionEnd : clock + 6 * 60 * MINUTE;
  // Only complete minute candles can prove the final close. Seconds in the
  // creation time or provider session boundary must not leave a final partial
  // minute that can never satisfy the replay's close-at-window-end condition.
  const end = Math.floor(rawEnd / MINUTE) * MINUTE;
  if (end <= Math.ceil(clock / MINUTE) * MINUTE + MINUTE) return [];
  const sessionKey = Number.isFinite(sessionStart) ? iso(sessionStart) : iso(clock).slice(0, 10);
  const rawCost = candidate.metrics?.roundTripCostBps;
  const spread = candidate.metrics?.spreadBps;
  const costBps = (finite(rawCost) && rawCost >= 0 ? rawCost : 20) + (finite(spread) && spread >= 0 ? spread : 0);
  if (!finite(costBps) || costBps > 10_000) return [];
  const plans = [];
  function add({ strategyId, strategyName, direction, entry, entryLow = entry, entryHigh = entry, stopLoss, targets, identity = 'session', quoteEntry = false }) {
    targets = (targets ?? []).slice(0, 3).map((target, index) => ({
      id: String(target.id ?? `target-${index + 1}`).slice(0, 80),
      label: String(target.label ?? target.risk ?? `Hedef ${index + 1}`).slice(0, 160),
      targetPrice: target.targetPrice, status: 'pending', hitAt: null, exitPrice: null, netReturnPct: null,
    })).sort((a, b) => Math.abs(a.targetPrice - entry) - Math.abs(b.targetPrice - entry));
    if (!orderedPlan(direction, entry, stopLoss, targets) || !positive(entryLow) || !positive(entryHigh)
      || entryLow > entry || entryHigh < entry || new Set(targets.map((target) => target.id)).size !== targets.length) return;
    const createdAt = iso(clock), trackingStartsAt = quoteEntry ? createdAt : iso(Math.ceil(clock / MINUTE) * MINUTE);
    const entryModel = quoteEntry ? 'quote-reference' : 'forward-limit';
    const entryDeadline = quoteEntry ? time(candidate.expiresAt) : Math.min(clock + 30 * MINUTE, end);
    const id = hash(`forward-v1|${candidate.symbol}|${mode}|${source}|${sessionKey}|${strategyId}|${direction}|${identity}`);
    plans.push({ id, symbol: candidate.symbol, name: String(candidate.name ?? candidate.symbol).slice(0, 160),
      market: candidate.market ?? (candidate.symbol.endsWith('.IS') ? 'BIST' : 'ABD'), currency: candidate.currency,
      mode, source, strategyId, strategyName, direction, sessionKey, createdAt, trackingStartsAt,
      trackingEndsAt: iso(end), entryDeadlineAt: iso(entryDeadline), entryModel, entry, entryLow, entryHigh, stopLoss, targets,
      status: quoteEntry ? 'active' : 'pending', enteredAt: quoteEntry ? createdAt : null, closedAt: null,
      lastBarAt: null, lastCheckedAt: createdAt, netReturnPct: null, costBps: round(costBps), costAssumed: true,
      trackingPolicy: 'forward-v1',
      executionModel: quoteEntry
        ? 'Yayındaki referans alış fiyatından anlık varsayımsal giriş. İlk kısmi mumda görülen çıkış seviyelerinin sırası belirsizdir. Gerçek emir gerçekleşmesi değildir.'
        : 'Yayından sonraki tam dakikalık mumlarda sabit giriş referansına (bölgenin orta noktası) temas beklenir. Giriş için en fazla 30 dakika; çıkış için kaynak seans sonu, seans bilinmiyorsa 6 saat. Gerçek emir gerçekleşmesi değildir.',
      events: [{ type: 'created', at: createdAt, message: 'Plan ve maliyet varsayımı değişmeden arşivlendi.', price: entry },
        ...(quoteEntry ? [{ type: 'entry', at: createdAt, message: 'Referans alış fiyatından varsayımsal giriş kaydedildi.', price: entry }] : [])],
    });
  }
  if ((mode === 'live' && isTradeCandidateFresh(candidate, clock))
    || (mode === 'research' && candidate.researchAssessment?.hasPlan === true)) {
    const targets = (candidate.scenarios ?? []).filter((scenario) => mode === 'research' || scenario.eligible === true);
    add({ strategyId: 'intraday', strategyName: 'Gün içi trade planı', direction: candidate.direction ?? 'long',
      entry: candidate.entry, stopLoss: candidate.stopLoss, targets, quoteEntry: mode === 'live' });
  }
  for (const strategy of candidate.videoStrategies ?? []) {
    if (strategy.dataStatus !== 'recent' || !Number.isFinite(time(strategy.evaluatedAt))
      || clock - time(strategy.evaluatedAt) > 5 * MINUTE || time(strategy.evaluatedAt) > clock + 2000) continue;
    const anchors = anchorKey(strategy.anchors);
    if (!anchors) continue;
    for (const setup of strategy.setups?.length ? strategy.setups : [strategy]) {
      if (!['zone', 'confirmed'].includes(setup.state) || !setup.levels) continue;
      const levels = setup.levels;
      add({ strategyId: String(strategy.id ?? 'video').slice(0, 100), strategyName: String(strategy.title ?? 'Video stratejisi').slice(0, 160),
        direction: setup.direction, entry: (levels.entryLow + levels.entryHigh) / 2,
        entryLow: levels.entryLow, entryHigh: levels.entryHigh, stopLoss: levels.stopLoss,
        targets: [{ id: setup.id ?? 'target', label: setup.title ?? 'Strateji hedefi', targetPrice: levels.targetPrice }], identity: anchors });
    }
  }
  return plans;
}

function event(record, type, at, message, price = null) {
  record.events.push({ type, at: iso(at), message, price });
}

function settle(record, target, status, at, exitPrice, message) {
  if (target.status !== 'pending') return;
  target.status = status;
  target.hitAt = iso(at);
  target.exitPrice = positive(exitPrice) ? exitPrice : null;
  target.netReturnPct = ['target', 'stop', 'expired'].includes(status) && record.enteredAt && positive(exitPrice)
    ? round((record.direction === 'short' ? record.entry - exitPrice : exitPrice - record.entry) / record.entry * 100 - record.costBps / 100) : null;
  event(record, status, at, `${target.label}: ${message}`, target.exitPrice);
}

function closeRemaining(record, status, at, message) {
  for (const target of record.targets) settle(record, target, status, at, null, message);
}

function refreshStatus(record, at) {
  record.netReturnPct = record.targets[0]?.netReturnPct ?? null;
  if (record.targets.some((target) => target.status === 'pending')) {
    record.status = record.enteredAt ? 'active' : 'pending';
    return;
  }
  const first = record.targets[0]?.status;
  record.status = TERMINAL.has(first) ? first : 'unresolved';
  record.closedAt = iso(at);
}

function compatible(record, snapshot) {
  const q = snapshot.quote ?? {};
  if (snapshot.symbol !== record.symbol || q.currency !== record.currency || q.source !== record.source) return false;
  return record.mode === 'live'
    ? q.realtime === true && q.sessionVerified === true && q.halted === false
    : q.realtime !== true;
}

/** Replay is idempotent. A missing minute makes outstanding scenarios
 * unresolvable; it cannot silently improve a result. Empty snapshots can age
 * an observation after a grace period without fabricating price coverage.
 */
export function advanceTradeHistory(record, snapshot = {}, { now = Date.now() } = {}) {
  const clock = clockOf(now);
  if (!record || !Number.isFinite(clock)) return record;
  if (TERMINAL.has(record.status)) return record;
  if (!Array.isArray(record.targets) || !record.targets.length) return record;
  const next = structuredClone(record);
  next.events ??= [];
  next.lastCheckedAt = iso(Math.max(time(record.lastCheckedAt) || 0, clock));
  const start = time(next.trackingStartsAt), end = time(next.trackingEndsAt), deadline = time(next.entryDeadlineAt);
  if (![start, end, deadline].every(Number.isFinite) || !orderedPlan(next.direction, next.entry, next.stopLoss, next.targets)) return record;
  const lastAt = time(next.lastBarAt);
  let expected = Number.isFinite(lastAt) ? lastAt + MINUTE : next.entryModel === 'quote-reference' ? Math.floor(start / MINUTE) * MINUTE : start;
  const incoming = Array.isArray(snapshot.bars) ? snapshot.bars : [];
  let bars = [];
  if (incoming.length && compatible(next, snapshot)) {
    // Ignore old closed sessions and unfinished future bars; malformed bars in
    // the new tracking window must not be discarded as if coverage were full.
    const relevant = incoming.filter((bar) => time(bar?.time) >= expected && time(bar.time) < end && time(bar.time) + MINUTE <= clock);
    if (relevant.some((bar) => !validBar(bar))) {
      closeRemaining(next, 'unresolved', clock, 'Geçersiz mum nedeniyle sonuç doğrulanamadı.');
      refreshStatus(next, clock);
      return next;
    }
    bars = [...relevant].sort((a, b) => time(a.time) - time(b.time));
    if (bars.some((bar, index) => index && bar.time === bars[index - 1].time)) {
      closeRemaining(next, 'unresolved', clock, 'Yinelenen mum zamanı nedeniyle sonuç doğrulanamadı.');
      refreshStatus(next, clock);
      return next;
    }
  }
  for (const bar of bars) {
    if (TERMINAL.has(next.status)) break;
    const at = time(bar.time), closed = at + MINUTE;
    if (at !== expected) {
      closeRemaining(next, 'unresolved', at, 'Takip penceresinde eksik dakikalık mum var.');
      refreshStatus(next, at);
      break;
    }
    // A final incomplete session minute cannot prove the closing path.
    if (closed > end) break;
    if (!next.enteredAt && closed > deadline) break;
    next.lastBarAt = iso(at);
    expected = closed;
    let entryInThisBar = false;
    const partial = next.entryModel === 'quote-reference' && at < start;
    if (!next.enteredAt) {
      if (bar.low <= next.entry && bar.high >= next.entry) {
        next.enteredAt = iso(bar.open === next.entry ? at : closed);
        next.status = 'active';
        entryInThisBar = bar.open !== next.entry;
        event(next, 'entry', bar.open === next.entry ? at : closed,
          bar.open === next.entry ? 'Tam mum açılışında sabit giriş referansı görüldü.' : 'Bu mumda sabit giriş referansına temas edildi; mum içi saat bilinmiyor.', next.entry);
      }
    }
    if (next.enteredAt) {
      const stopHit = next.direction === 'long' ? bar.low <= next.stopLoss : bar.high >= next.stopLoss;
      const stopAtOpen = next.direction === 'long' ? bar.open <= next.stopLoss : bar.open >= next.stopLoss;
      for (const target of next.targets) {
        if (target.status !== 'pending') continue;
        const targetHit = next.direction === 'long' ? bar.high >= target.targetPrice : bar.low <= target.targetPrice;
        const targetAtOpen = next.direction === 'long' ? bar.open >= target.targetPrice : bar.open <= target.targetPrice;
        if ((partial || entryInThisBar) && (stopHit || targetHit)) {
          settle(next, target, 'ambiguous', closed, null, partial
            ? 'İlk kısmi mumda seviye görüldü; yayından önce mi sonra mı olduğu bilinmiyor.'
            : 'Giriş ve çıkış aynı mumda; temas sırası bilinmiyor.');
        } else if (stopAtOpen) {
          settle(next, target, 'stop', at, bar.open, 'Mum stopun ötesinde açıldı; olumsuz fiyat boşluğu açılış fiyatıyla hesaba katıldı.');
        } else if (targetAtOpen) {
          settle(next, target, 'target', at, target.targetPrice, 'Hedef mum açılışında aşılmıştı; hesap sabit hedef fiyatından yapıldı.');
        } else if (stopHit && targetHit) {
          settle(next, target, 'ambiguous', closed, null, 'Hedef ve stop aynı mumda görüldü; ilk temas sırası bilinmiyor.');
        } else if (stopHit) {
          settle(next, target, 'stop', closed, next.stopLoss, 'Zarar kes seviyesi görüldü.');
        } else if (targetHit) {
          settle(next, target, 'target', closed, target.targetPrice, 'Hedef seviyesi stop öncesinde görüldü.');
        }
      }
    }
    if (closed >= end) {
      for (const target of next.targets) settle(next, target, 'expired', closed, next.enteredAt ? bar.close : null,
        next.enteredAt ? 'Takip penceresi sonundaki son kapanışla varsayımsal çıkış.' : 'Takip penceresi içinde giriş oluşmadı.');
    } else if (!next.enteredAt && closed >= Math.floor(deadline / MINUTE) * MINUTE) {
      closeRemaining(next, 'expired', closed, 'Giriş için ayrılan tam mum penceresinde giriş referansına temas olmadı.');
    }
    refreshStatus(next, closed);
  }
  // Give delayed bars a chance to arrive. No data is never a losing trade.
  const ageLimit = next.enteredAt ? end : deadline;
  if (!TERMINAL.has(next.status) && clock >= ageLimit + GRACE) {
    const coveredUntil = Number.isFinite(time(next.lastBarAt)) ? time(next.lastBarAt) + MINUTE : start;
    const needed = Math.floor(ageLimit / MINUTE) * MINUTE;
    if (!next.enteredAt && coveredUntil >= needed) closeRemaining(next, 'expired', ageLimit, 'Giriş penceresi sona erdi; giriş oluşmadı.');
    else closeRemaining(next, 'unresolved', ageLimit, 'Takip penceresinin tamamı için fiyat verisi alınamadı.');
    refreshStatus(next, ageLimit);
  }
  return next;
}

export function summarizeTradeHistory(records = []) {
  const summary = { total: records.length, pending: 0, active: 0, completed: 0, resolved: 0, settledCount: 0, targetCount: 0, stopCount: 0,
    expiredCount: 0, ambiguousCount: 0, unresolvedCount: 0, winRate: null, averageNetReturnPct: null, byTarget: [] };
  const groups = new Map(), returns = [];
  for (const record of records) {
    if (record.status === 'pending') summary.pending++;
    else if (record.status === 'active') summary.active++;
    else if (TERMINAL.has(record.status)) summary.completed++;
    if (record.status === 'expired') summary.expiredCount++;
    if (record.status === 'ambiguous') summary.ambiguousCount++;
    if (record.status === 'unresolved') summary.unresolvedCount++;
    const primary = record.targets?.[0];
    if (['target', 'stop'].includes(primary?.status)) {
      summary.resolved++;
      summary[primary.status === 'target' ? 'targetCount' : 'stopCount']++;
    }
    if (['target', 'stop', 'expired'].includes(primary?.status) && record.enteredAt && finite(primary.netReturnPct)) returns.push(primary.netReturnPct);
    for (const target of record.targets ?? []) {
      const key = `${record.strategyId}|${target.id}|${target.label}`;
      if (!groups.has(key)) groups.set(key, { strategyId: record.strategyId, id: target.id, label: target.label, total: 0, resolved: 0, settledCount: 0, targetCount: 0, stopCount: 0, winRate: null, averageNetReturnPct: null, returns: [] });
      const group = groups.get(key);
      group.total++;
      if (['target', 'stop'].includes(target.status)) {
        group.resolved++;
        group[target.status === 'target' ? 'targetCount' : 'stopCount']++;
      }
      if (['target', 'stop', 'expired'].includes(target.status) && record.enteredAt && finite(target.netReturnPct)) group.returns.push(target.netReturnPct);
    }
  }
  summary.winRate = summary.resolved ? round(summary.targetCount / summary.resolved * 100) : null;
  summary.settledCount = returns.length;
  summary.averageNetReturnPct = returns.length ? round(returns.reduce((sum, value) => sum + value, 0) / returns.length) : null;
  summary.byTarget = [...groups.values()].map(({ returns: values, ...group }) => ({ ...group,
    settledCount: values.length,
    winRate: group.resolved ? round(group.targetCount / group.resolved * 100) : null,
    averageNetReturnPct: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
  }));
  return summary;
}

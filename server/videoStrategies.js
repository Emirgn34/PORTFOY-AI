/**
 * Reproducible interpretations of two chart-only videos, not a backtested
 * trading system. Every pivot needs two CLOSED bars on each side. No level or
 * state here authorizes an order: feed/session/cost gates belong to tradeEngine.
 * Bars use the opening timestamp of a one-minute candle.
 */
const MINUTE = 60_000;
const PIVOT = 2;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const round = (value) => finite(value) ? Number(value.toPrecision(9)) : null;
const timeOf = (value) => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const iso = (value) => new Date(value).toISOString();
const SOURCES = [
  { id: 'choch-fib-pullback', title: 'CHoCH + Fibonacci geri çekilmesi', sourceUrl: 'https://x.com/nanaT3__7717/status/2120810656308113711' },
  { id: 'parallel-channel-reversal', title: 'Paralel kanal dönüşü + 0,786 bölgesi', sourceUrl: 'https://x.com/mzgaangy/status/2120806522259440007' },
];
const COMMON = [
  'Videoda sembol, zaman dilimi ve sayısal teyit kuralı yoktur; burada 1 dakikalık, kapanmış mumlar kullanılır.',
  'Salınımlar iki sol ve iki sağ kapanmış mumla teyit edilir; son iki mum pivot olarak kullanılamaz.',
  'En az 30 kesintisiz mum; tolerans ATR(14) × 0,25. Bu parametreler uygulama varsayımıdır.',
  'Teyit yalnızca mum geometrisini anlatır; canlı veri doğrulaması, maliyet ve seans kontrolleri ayrıca gerekir. Getiri/risk brüttür.',
];

function validBar(bar) {
  return ['open', 'high', 'low', 'close'].every((key) => positive(bar?.[key]))
    && bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close) && bar.high >= bar.low;
}

function prepare(input, clock) {
  const completed = (Array.isArray(input?.bars) ? input.bars : []).filter((bar) => {
    const time = timeOf(bar?.time);
    return Number.isFinite(time) && time + MINUTE <= clock && bar.closed !== false && bar.complete !== false && bar.isClosed !== false;
  }).sort((a, b) => timeOf(a.time) - timeOf(b.time)).slice(-500);
  if (completed.some((bar) => !validBar(bar))) return { bars: [], error: 'Kapanmış mumlarda geçersiz OHLC değeri var.' };
  if (completed.some((bar, index) => index && timeOf(bar.time) === timeOf(completed[index - 1].time))) {
    return { bars: [], error: 'Yinelenen mum zamanı var; kanal hesabı yapılmadı.' };
  }
  if (completed.some((bar) => timeOf(bar.time) % MINUTE !== 0)) return { bars: [], error: 'Mumlar dakika başlangıcına hizalı değil.' };
  // Never bridge missing candles or overnight sessions with a synthetic line.
  let start = completed.length - 1;
  while (start > 0 && timeOf(completed[start].time) - timeOf(completed[start - 1].time) === MINUTE) start--;
  let bars = completed.slice(Math.max(0, start)).slice(-240);
  const sessionStart = timeOf(input?.quote?.sessionStartsAt);
  if (Number.isFinite(sessionStart)) bars = bars.filter((bar) => timeOf(bar.time) >= sessionStart);
  if (bars.length < 30) return { bars, error: 'Strateji için aynı seansta en az 30 kesintisiz kapanmış dakikalık mum gerekiyor.' };
  const ranges = bars.slice(1).map((bar, index) => Math.max(bar.high - bar.low, Math.abs(bar.high - bars[index].close), Math.abs(bar.low - bars[index].close)));
  const atr = ranges.slice(-14).reduce((sum, value) => sum + value, 0) / Math.min(14, ranges.length);
  if (!positive(atr)) return { bars, error: 'Kanal ve risk mesafesi için ölçülebilir oynaklık bulunmuyor.' };
  return { bars, atr, stale: clock - timeOf(bars.at(-1).time) - MINUTE > 5 * MINUTE };
}

function pivotsOf(bars) {
  const pivots = [];
  for (let index = PIVOT; index < bars.length - PIVOT; index++) {
    const around = bars.slice(index - PIVOT, index + PIVOT + 1);
    const high = around.every((bar, offset) => offset === PIVOT || bar.high < bars[index].high);
    const low = around.every((bar, offset) => offset === PIVOT || bar.low > bars[index].low);
    // An outside candle can be both extrema. Its intrabar order is unknown.
    if (high === low) continue;
    const pivot = { index, type: high ? 'high' : 'low', price: high ? bars[index].high : bars[index].low,
      time: bars[index].time, confirmedAt: iso(timeOf(bars[index + PIVOT].time) + MINUTE) };
    const previous = pivots.at(-1);
    if (previous?.type === pivot.type) {
      if (high ? pivot.price > previous.price : pivot.price < previous.price) pivots[pivots.length - 1] = pivot;
    } else pivots.push(pivot);
  }
  return pivots;
}

function anchorAtr(bars, throughIndex) {
  if (throughIndex < 14) return null;
  let total = 0;
  for (let index = throughIndex - 13; index <= throughIndex; index++) {
    const bar = bars[index], previous = bars[index - 1];
    total += Math.max(bar.high - bar.low, Math.abs(bar.high - previous.close), Math.abs(bar.low - previous.close));
  }
  return total / 14;
}

function levels(direction, low, high, stop, target) {
  if (![low, high, stop, target].every(positive) || low > high) return null;
  if (direction === 'long' ? !(stop < low && target > high) : !(stop > high && target < low)) return null;
  const entry = (low + high) / 2;
  const rewardRisk = direction === 'long' ? (target - entry) / (entry - stop) : (entry - target) / (stop - entry);
  const result = { entryLow: round(low), entryHigh: round(high), stopLoss: round(stop), targetPrice: round(target), rewardRisk: round(rewardRisk) };
  if (direction === 'long' ? !(result.stopLoss < result.entryLow && result.targetPrice > result.entryHigh)
    : !(result.stopLoss > result.entryHigh && result.targetPrice < result.entryLow)) return null;
  return result;
}

function line(label, bars, fromIndex, fromPrice, toIndex, toPrice, kind = 'channel') {
  return { label, kind, from: { time: bars[fromIndex].time, price: round(fromPrice) }, to: { time: bars[toIndex].time, price: round(toPrice) } };
}

function firstStrategy(bars, pivots, atr) {
  const latest = bars.at(-1), previous = bars.at(-2), lastIndex = bars.length - 1;
  let sequence;
  for (let index = pivots.length - 3; index >= 0; index--) {
    const triple = pivots.slice(index, index + 3);
    if (triple[0].type === 'high' && triple[1].type === 'low' && triple[2].type === 'high') { sequence = triple; break; }
  }
  if (!sequence) return { state: 'waiting', direction: 'long', levels: null, reasons: ['Teyit edilmiş tepe → dip → daha yüksek tepe dizisi bekleniyor.'] };
  const [prior, bottom, peak] = sequence;
  if (peak.price <= prior.price || bottom.price >= prior.price) return { state: 'waiting', direction: 'long', levels: null, reasons: ['Önceki tepe üzerinde yeni tepe ve yükselen kanal oluşmadı.'] };
  // Freeze risk/tolerance to the moment this structure first became observable.
  // Later volatility must not move an already breached stop farther away.
  atr = anchorAtr(bars, peak.index + PIVOT);
  if (!positive(atr)) return { state: 'waiting', direction: 'long', levels: null, reasons: ['Yapının teyit anında 14 mumluk ATR geçmişi yok.'] };
  const crossed = bars.slice(bottom.index + 1, peak.index + 1).some((bar, offset) => bar.close > prior.price && bars[bottom.index + offset].close <= prior.price);
  if (!crossed) return { state: 'waiting', direction: 'long', levels: null, reasons: ['Önceki tepenin üzerinde kapanış (CHoCH) yok; yalnızca fitil kırılması yeterli değil.'] };
  const slope = (peak.price - prior.price) / (peak.index - prior.index);
  const upper = (index) => prior.price + slope * (index - prior.index);
  const width = upper(bottom.index) - bottom.price;
  if (!(width > 2 * atr)) return { state: 'waiting', direction: 'long', levels: null, reasons: ['Kanal genişliği güncel ATR karşısında yetersiz.'] };
  const lower = (index) => upper(index) - width;
  const impulse = peak.price - bottom.price;
  const plan = levels('long', peak.price - impulse * 0.618, peak.price - impulse * 0.5,
    peak.price - impulse * 0.618 - atr * 0.25, peak.price + impulse * 0.5);
  if (!plan) return { state: 'waiting', direction: 'long', levels: null, reasons: ['Pozitif ve sıralı giriş, zarar kes ve hedef seviyeleri oluşmadı.'] };
  const postPeak = bars.slice(peak.index + 1);
  const stopped = postPeak.some((bar) => bar.low <= plan.stopLoss);
  const targetHit = postPeak.some((bar) => bar.high >= plan.targetPrice);
  const outside = latest.close < lower(lastIndex) - atr * 0.5 || latest.close > upper(lastIndex) + atr * 0.5;
  const touched = postPeak.slice(-2).some((bar) => bar.low <= plan.entryHigh && bar.high >= plan.entryLow);
  const near = latest.close >= plan.entryLow && latest.close <= plan.entryHigh + atr * 0.25;
  const bounce = touched && near && latest.close > latest.open && latest.close > previous.close;
  const state = stopped || targetHit || outside ? 'invalidated' : bounce ? 'confirmed' : touched && near ? 'zone' : 'watch';
  return { state, direction: 'long', levels: plan, confirmationAt: bounce && state === 'confirmed' ? iso(timeOf(latest.time) + MINUTE) : null,
    reasons: [
      `Önceki teyitli tepe üzerinde kapanış var; yükselen paralel kanal ve %50–61,8 geri çekilme bölgesi hesaplandı.`,
      stopped ? 'Kurulumdan sonra zarar kes seviyesi görüldü; eski giriş yeniden kullanılmaz.' : targetHit ? 'Hedef daha önce görüldü; eski kurulum tamamlandı.'
        : outside ? 'Son kapanış kanal sınırları dışında; kurulum geçersiz.' : bounce ? 'Son kapanmış mum giriş bölgesinden yükseliş yönünde döndü.'
          : touched && near ? 'Fiyat giriş bölgesinde; yükseliş yönünde kapanış teyidi bekleniyor.' : 'Geri çekilme bölgesine güncel dönüş bekleniyor.',
    ],
    anchors: { priorHigh: prior, swingLow: bottom, impulseHigh: peak },
    chartLines: [line('Kanal üstü', bars, prior.index, prior.price, lastIndex, upper(lastIndex)), line('Kanal altı', bars, bottom.index, bottom.price, lastIndex, lower(lastIndex)),
      line('CHoCH', bars, prior.index, prior.price, lastIndex, prior.price, 'structure')],
  };
}

function secondStrategy(bars, pivots, atr) {
  const lastIndex = bars.length - 1, latest = bars.at(-1), previous = bars.at(-2);
  let sequence;
  for (let index = pivots.length - 3; index >= 0; index--) {
    const triple = pivots.slice(index, index + 3);
    if (triple[0].type === 'low' && triple[1].type === 'high' && triple[2].type === 'low') { sequence = triple; break; }
  }
  if (!sequence || sequence[2].price <= sequence[0].price) return { state: 'waiting', direction: null, levels: null, setups: [], reasons: ['Yükselen iki teyitli dip ve aralarında kanal yüksekliğini belirleyen tepe bekleniyor.'] };
  const [firstLow, high, secondLow] = sequence;
  atr = anchorAtr(bars, secondLow.index + PIVOT);
  if (!positive(atr)) return { state: 'waiting', direction: null, levels: null, setups: [], reasons: ['Kanal teyit anında 14 mumluk ATR geçmişi yok.'] };
  const slope = (secondLow.price - firstLow.price) / (secondLow.index - firstLow.index);
  const lower = (index) => firstLow.price + slope * (index - firstLow.index);
  const width = high.price - lower(high.index);
  if (!(width > 2 * atr)) return { state: 'waiting', direction: null, levels: null, setups: [], reasons: ['Paralel kanal genişliği ATR karşısında yetersiz.'] };
  const support = lower(lastIndex), resistance = support + width, fib = support + width * 0.786;
  const long = levels('long', support - atr * 0.25, support + atr * 0.25, support - atr, resistance - atr * 0.25);
  const short = levels('short', fib, resistance + atr * 0.25, resistance + atr, support + atr * 0.25);
  if (!long || !short) return { state: 'waiting', direction: null, levels: null, setups: [], reasons: ['Kanalın iki yönü için sıralı ve pozitif risk seviyeleri oluşmadı.'] };
  const longTouched = latest.low <= long.entryHigh && latest.high >= long.entryLow;
  const shortTouched = latest.high >= short.entryLow && latest.low <= short.entryHigh;
  // Once observed after pivot confirmation, a channel break invalidates these
  // anchors even if the next candle moves back inside. A new pivot sequence is
  // required; the same old channel cannot silently reactivate.
  const outside = bars.slice(secondLow.index + PIVOT + 1).some((bar, offset) => {
    const supportAtBar = lower(secondLow.index + PIVOT + 1 + offset);
    return bar.low < supportAtBar - atr || bar.high > supportAtBar + width + atr;
  });
  const longBounce = longTouched && latest.close >= long.entryLow && latest.close <= long.entryHigh + atr * 0.25 && latest.close > latest.open && latest.close > previous.close;
  const shortBounce = shortTouched && latest.close <= short.entryHigh && latest.close >= short.entryLow - atr * 0.25 && latest.close < latest.open && latest.close < previous.close;
  const setups = [
    { id: 'channel-long', title: 'Alt kanaldan dönüş', direction: 'long', state: outside ? 'invalidated' : longBounce ? 'confirmed' : longTouched ? 'zone' : 'watch', levels: long,
      reasons: [outside ? 'Mum kanal risk sınırını aştı; yeni kanal teyidi gerekir.' : longBounce ? 'Alt kanal temasından sonra yükseliş yönünde kapanış var.' : longTouched ? 'Alt kanala temas var; yükseliş yönünde kapanış bekleniyor.' : 'Alt kanal temas bölgesine dönüş bekleniyor.'] },
    { id: 'channel-short', title: 'Üst kanal / 0,786 bölgesinden dönüş', direction: 'short', state: outside ? 'invalidated' : shortBounce ? 'confirmed' : shortTouched ? 'zone' : 'watch', levels: short,
      reasons: [outside ? 'Mum kanal risk sınırını aştı; yeni kanal teyidi gerekir.' : shortBounce ? 'Üst kanal bölgesinden düşüş yönünde kapanış var.' : shortTouched ? 'Üst kanal bölgesine temas var; düşüş yönünde kapanış bekleniyor.' : 'Üst kanal / 0,786 temas bölgesine dönüş bekleniyor.'] },
  ];
  const rank = { confirmed: 3, zone: 2, watch: 1, invalidated: 0 };
  const selected = [...setups].sort((a, b) => rank[b.state] - rank[a.state])[0];
  return { ...selected, id: undefined, title: undefined, setups, reasons: ['İki teyitli yükselen dipten paralel kanal kuruldu.', ...selected.reasons],
    anchors: { firstLow, swingHigh: high, secondLow },
    chartLines: [line('Kanal altı', bars, firstLow.index, firstLow.price, lastIndex, support), line('Kanal üstü', bars, firstLow.index, firstLow.price + width, lastIndex, resistance),
      line('Kanal 0,786', bars, firstLow.index, firstLow.price + width * 0.786, lastIndex, fib, 'fib')],
  };
}

export function evaluateVideoStrategies(input = {}, { now = Date.now() } = {}) {
  const clock = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(clock)) throw new Error('Geçerli değerlendirme zamanı gerekli.');
  const data = prepare(input, clock), pivots = data.error ? [] : pivotsOf(data.bars);
  return SOURCES.map((source, index) => {
    const result = data.error ? { state: 'waiting', direction: index ? null : 'long', levels: null, reasons: [data.error] }
      : index ? secondStrategy(data.bars, pivots, data.atr) : firstStrategy(data.bars, pivots, data.atr);
    const { chartLines = [], id: unusedId, title: unusedTitle, ...body } = result;
    const stale = !data.error && data.stale;
    return { ...source, ...body, ...(stale ? { patternState: body.state, state: 'waiting', reasons: ['Son kapanmış mum 5 dakikadan eski; seviyeler yalnızca geçmiş araştırma bağlamıdır.', ...body.reasons],
      setups: body.setups?.map((setup) => ({ ...setup, patternState: setup.state, state: 'waiting' })) } : {}),
      dataMode: 'research', dataStatus: data.error ? 'insufficient' : stale ? 'stale' : 'recent', actionable: false,
      symbol: typeof input?.symbol === 'string' ? input.symbol : null,
      assumptions: [...COMMON, index
        ? 'Videodaki eğik 0,786 işaretinin ölçüm formülü verilmemiştir. Burada son iki yükselen dipten kanal, aradaki tepeden genişlik ve kanal yüksekliğinin %78,6–100 bölgesi kullanılır; birebir video formülü iddiası yoktur. Zarar kes kanalın 1 ATR dışındadır. ATR, ikinci dip teyit anında sabitlenir.'
        : 'Video giriş bölgesi %50–61,8 geri çekilmesidir. Zarar kes bölgenin 0,25 ATR altı; hedef gözlenen impuls tepesinin yarım impuls üstüdür. Teyit iki son mumdaki temas ve son mumun yükseliş kapanışıdır. ATR, impuls tepesi teyit anında sabitlenir.'],
      evaluatedAt: iso(clock), lastBarTime: data.bars.at(-1)?.time ?? null,
      chart: { bars: data.bars.slice(-120).map(({ time, open, high, low, close }) => ({ time, open, high, low, close })), lines: chartLines },
    };
  });
}

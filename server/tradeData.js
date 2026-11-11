import { checked, recordMonitor } from './automationDb.js';
import { buildTradeCandidate, isTradeCandidateFresh } from './tradeEngine.js';
import { deliverNotifications, pushConfigured } from './pushNotifications.js';
import { mapLimit } from './concurrency.js';

// Tazelik eşiklerinin TEK TANIM YERİ burasıdır; arayüz bunları /api/trade
// status alanından okur (TradePage live()). DİKKAT: SQL tarafındaki
// trade_delivery_allowed (supabase/migrations/20261111_trade.sql) "15 saniye"
// kuralını bağımsız uygular — buradaki değeri değiştirirsen SQL'i de güncelle.
export const TRADE_QUOTE_MAX_AGE_MS = 15_000;
export const TRADE_BAR_MAX_AGE_MS = 90_000;
const symbolPattern = /^[A-Z][A-Z0-9.-]{0,14}$/;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const timestamp = (value) => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const contextCache = new WeakMap();

export function candidateTradeSymbol(row) {
  const symbol=String(row?.symbol ?? '').toUpperCase();
  return (row?.market ?? row?.data?.market)==='BIST' && !symbol.endsWith('.IS') ? `${symbol}.IS` : symbol;
}

export function buildResearchTradeItem(row, {now=Date.now(),feedConfigured=false}={}) {
  const item=buildTradeCandidate({symbol:candidateTradeSymbol(row),quote:{},bars:[],context:{
    candidate:{...row.data,horizon:'short',updatedAt:row.updated_at},news:[],macroEvents:[],
  }},{now});
  return {...item,availability:'research-only',reasons:['Mevcut fırsat havuzundan araştırma adayı; doğrulanmış canlı trade sinyali henüz oluşmadı.'],
    blockers:[feedConfigured
      ? 'Bu hisse için doğrulanmış canlı trade verisi henüz alınmadı.'
      : 'Canlı trade veri kaynağı henüz bağlanmadı. Bu kart mevcut araştırma verilerinden gösteriliyor.'],
    dataQuality:{...item.dataQuality,currencyVerified:false},
  };
}

export function tradeMonitorState(monitor, now=Date.now()) {
  const heartbeatMaxAgeMs=monitor?.data?.mode==='delayed-research'?90_000:30_000;
  const age=now-Date.parse(monitor?.updated_at);
  return {heartbeatMaxAgeMs,running:Boolean(monitor?.data?.ok && monitor.data.running!==false
    && Number.isFinite(age) && age>=-2000 && age<heartbeatMaxAgeMs)};
}

// This is the adapter contract, not a claim that a public Yahoo quote is live.
// Only an operator-configured licensed source can set realtime/session flags.
export function normalizeTradeBatch(payload, { source, licensed = false, now = Date.now() } = {}) {
  if (!source || typeof source !== 'string' || source.length > 100) throw new Error('Veri kaynağı yapılandırılmamış.');
  if (!Array.isArray(payload?.items) || !payload.items.length || payload.items.length > 50) throw new Error('Bir istekte 1–50 hisse gönderin.');
  const seen = new Set();
  return payload.items.map((item) => {
    const symbol = String(item?.symbol ?? '').trim().toUpperCase();
    if (!symbolPattern.test(symbol) || seen.has(symbol)) throw new Error('Hisse sembolleri geçerli ve tekil olmalı.');
    seen.add(symbol);
    const q = item.quote;
    if (!q || !finite(q.price) || q.price <= 0 || !timestamp(q.marketTime)) throw new Error('Fiyat ve saat dilimi içeren ISO borsa zaman damgası gerekli.');
    if (Date.parse(q.marketTime) > now + 2_000) throw new Error('Gelecek zamanlı fiyat kabul edilmez.');
    if (!Array.isArray(item.bars) || item.bars.length > 500) throw new Error('En fazla 500 adet kapanmış bir dakikalık mum gönderin.');
    const bars = item.bars.map((bar) => {
      if (!timestamp(bar.time) || Date.parse(bar.time) > now + 2_000 ||
        !['open','high','low','close','volume'].every((key) => finite(bar[key])) ||
        Math.min(bar.open,bar.high,bar.low,bar.close) <= 0 || bar.volume < 0 ||
        bar.high < Math.max(bar.open,bar.close,bar.low) || bar.low > Math.min(bar.open,bar.close,bar.high)) {
        throw new Error('Mumlarda zaman, OHLC ve hacim alanları geçerli olmalı.');
      }
      return { time: new Date(bar.time).toISOString(), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };
    });
    for (let i=1;i<bars.length;i++) if (bars[i].time <= bars[i-1].time) throw new Error('Mumlar tekil ve artan zamanda olmalı.');
    return { symbol, bars, quote: {
      price: q.price, bid: finite(q.bid) && q.bid > 0 ? q.bid : null, ask: finite(q.ask) && q.ask > 0 ? q.ask : null,
      currency: ['TRY','USD','EUR','GBP'].includes(q.currency) ? q.currency : null,
      name: String(q.name ?? symbol).slice(0,200), marketTime: new Date(q.marketTime).toISOString(), receivedAt: new Date(now).toISOString(),
      source, realtime: licensed && q.realtime === true,
      sessionVerified: licensed && q.sessionVerified === true,
      sessionStartsAt: timestamp(q.sessionStartsAt) ? new Date(q.sessionStartsAt).toISOString() : null,
      sessionEndsAt: timestamp(q.sessionEndsAt) ? new Date(q.sessionEndsAt).toISOString() : null,
      halted: q.halted !== false, marketState: String(q.marketState ?? 'UNKNOWN').slice(0,20),
      barIntervalSeconds: item.barIntervalSeconds === 60 ? 60 : null,
    } };
  });
}

export async function loadTradeContexts(sb, symbols) {
  if (!symbols.length) return new Map();
  const cacheKey=[...symbols].sort().join(',');
  const cached=contextCache.get(sb);
  if (cached?.key===cacheKey && cached.until>Date.now()) return cached.value;
  const candidateSymbols=[...new Set(symbols.flatMap((symbol)=>symbol.endsWith('.IS')?[symbol,symbol.slice(0,-3)]:[symbol]))];
  const [candidateResult, newsResult, contextResult] = await Promise.all([
    sb.from('candidates').select('symbol,market,data,updated_at').in('symbol',candidateSymbols).eq('horizon','short'),
    sb.from('news').select('symbol,title,title_tr,link,publisher,published_at,sentiment,reliability').in('symbol',symbols).order('published_at',{ascending:false}).limit(200),
    sb.from('trade_context').select('symbol,data,updated_at').in('symbol',symbols),
  ]);
  const candidates = checked(candidateResult) ?? [], news = checked(newsResult) ?? [], contexts = checked(contextResult) ?? [];
  const value=new Map(symbols.map((symbol) => {
    const cached = contexts.find((row) => row.symbol === symbol);
    const candidate = candidates.find((row) => candidateTradeSymbol(row) === symbol);
    return [symbol, { ...(cached?.data ?? {}), candidate: candidate ? { ...candidate.data, horizon:'short', updatedAt: candidate.updated_at } : null,
      news: news.filter((row) => row.symbol === symbol).slice(0,8).map((row) => ({
        title: row.title_tr || row.title, url: row.link, publisher:row.publisher, publishedAt: row.published_at, sentiment: row.sentiment, reliability: row.reliability,
      })), contextUpdatedAt: cached?.updated_at ?? null }];
  }));
  // Quotes remain uncached. A short context cache keeps research SQL off most
  // one-second feed updates without treating daily context as live prices.
  contextCache.set(sb,{key:cacheKey,until:Date.now()+5000,value});
  return value;
}

export async function processTradeBatch(sb, payload, { source, licensed = false, now = () => Date.now(),
  build = buildTradeCandidate, deliver = (db) => deliverNotifications(db,{topics:['trade']}), env = process.env } = {}) {
  const started = now();
  const items = normalizeTradeBatch(payload,{source,licensed,now:started});
  const contexts = await loadTradeContexts(sb,items.map((item) => item.symbol));
  const results = await mapLimit(items,4,async(item)=>{
    const candidate = build({...item,context:contexts.get(item.symbol)}, { now:now(),
      maxQuoteAgeMs:TRADE_QUOTE_MAX_AGE_MS,maxBarAgeMs:TRADE_BAR_MAX_AGE_MS,
      roundTripCostBps:Number(env.TRADE_ROUND_TRIP_COST_BPS || 20) });
    // The DB rejects out-of-order publications and commits the signal/outbox in
    // one transaction; a failed notification insert cannot silently lose it.
    const published = checked(await sb.rpc('publish_trade_signal', { p_signal:candidate,
      p_quote_time:item.quote.marketTime, p_realtime:item.quote.realtime, p_source:source }));
    return {symbol:item.symbol,status:candidate.status,published:Boolean(published)};
  });
  const durationMs = Math.max(0,now()-started);
  await recordMonitor(sb,'trade',{ok:true,mode:licensed?'licensed-http':'delayed-research',source,
    running:true,heartbeatMaxAgeMs:licensed?30_000:90_000,lastCycleAt:new Date(now()).toISOString(),latencyMs:durationMs,checkedCount:items.length,
    readyCount:results.filter((item) => item.status === 'ready').length,
    quoteMaxAgeMs:TRADE_QUOTE_MAX_AGE_MS,barMaxAgeMs:TRADE_BAR_MAX_AGE_MS,
    message:licensed?'Lisanslı adaptör verisi işleniyor. Telefon teslim süresi operatöre ve cihaza bağlıdır.':'Gecikmeli araştırma verisi: canlı trade ve trade bildirimi kapalı.'});
  // An accepted signal is already durable before the provider is contacted.
  const delivery = deliver===false ? {queued:true} : await deliver(sb).catch(() => ({configured:pushConfigured(),error:'Bildirim sonraki döngüde yeniden denenecek.'}));
  return {items:results,durationMs,delivery};
}

export function currentTradeItem(candidate, now = Date.now()) {
  if (candidate.status !== 'ready' || isTradeCandidateFresh(candidate,now)) return candidate;
  return {...candidate,status:'blocked',blockers:[...(candidate.blockers ?? []),'Canlı sinyalin geçerlilik süresi doldu; yeni fiyat bekleniyor.'],
    scenarios:(candidate.scenarios ?? []).map((scenario) => ({...scenario,eligible:false}))};
}

export function tradeRequirements({licensedSource,monitor,pushReady,hasContext,items=[],now=Date.now()} = {}) {
  const {running}=tradeMonitorState(monitor,now);
  const verifiedQuote=items.some((item)=>{
    const q=item.dataQuality,quoteTime=Date.parse(q?.quoteTime);
    return q?.realtime===true && q.currencyVerified===true && q.sessionVerified===true && q.halted===false
      && now-quoteTime<=TRADE_QUOTE_MAX_AGE_MS && quoteTime<=now+2000 && Number.isFinite(item.metrics?.spreadBps);
  });
  return [
    {id:'realtime',label:'Lisanslı gerçek zamanlı fiyat ve alış/satış',status:!licensedSource?'missing':running && monitor?.data?.mode==='licensed-http' && verifiedQuote?'available':'partial',detail:'Borsa zaman damgalı fiyat, spread, seans ve durdurma bilgisi; fiyat yaşı en fazla 15 saniye. Kaynak adının tanımlanması tek başına doğrulanmış fiyat değildir.'},
    {id:'intraday',label:'Bir dakikalık OHLCV ve veri kalite kapısı',status:running?'partial':'missing',detail:'En az 40 kapanmış mum, hacim, VWAP, ATR, RSI ve momentum; son mum en fazla 90 saniye eski.'},
    {id:'context',label:'Mevcut haber ve araştırma verileri',status:hasContext?'available':'partial',detail:'Fırsat analizleri, haberler, makro takvim ve şirket olayları bağlam olarak birleştirilir; günlük veriler canlı fiyat yerine geçmez.'},
    {id:'risk',label:'Maliyet, stop ve hedef senaryoları',status:'available',detail:'Volatiliteye uyarlanan hedefler, spread ve işlem maliyeti sonrası risk/getiri; hedefler gerçekleşme garantisi taşımaz.'},
    {id:'worker',label:'Kesintisiz veri adaptörü',status:running?'available':'missing',detail:'Webhook anında işler; alternatif sürekli worker varsayılan 1 saniyelik sorgularla çalışır. Cron canlı trade için uygun değildir.'},
    {id:'push',label:'Telefona Web Push',status:pushReady?'available':'missing',detail:'VAPID, cihaz izni ve Trade aboneliği gerekir. Kilit ekranı teslim süresinin üst sınırı garanti edilemez.'},
    {id:'validation',label:'Canlı öncesi strateji doğrulaması',status:'partial',detail:'Motor kuralları test edilir; bağımsız geçmiş test ve ileriye dönük kâğıt işlemlerle performans ölçümü gerekir. Skor başarı olasılığı değildir.'},
  ];
}

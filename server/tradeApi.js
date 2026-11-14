import { automationDb, checked } from './automationDb.js';
import { validCronSecret } from './cronAuth.js';
import { pushConfigured } from './pushNotifications.js';
import { buildResearchTradeItem, candidateTradeSymbol, currentTradeItem, processTradeBatch, tradeRequirements, tradeMonitorState, TRADE_QUOTE_MAX_AGE_MS, TRADE_BAR_MAX_AGE_MS } from './tradeData.js';
import { refreshResearchTradeItems } from './tradeWorker.js';
import { readTradeHistory } from './tradeHistory.js';

export function createTradeHandler({ getDb=automationDb, processBatch=processTradeBatch, refreshResearch=refreshResearchTradeItems, readHistory=readTradeHistory, env=process.env, now=()=>Date.now() } = {}) {
  return async function tradeHandler(req,res) {
    res.setHeader('Cache-Control','no-store');
    const action=req.query?.action ?? 'state';
    if (!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Yöntem desteklenmiyor.'});
    // Licensed feeds use a separate server-only credential, never a user's JWT.
    if (action==='ingest') {
      if (req.method!=='POST') return res.status(405).json({error:'Yöntem desteklenmiyor.'});
      if (!validCronSecret(req.headers?.['x-trade-secret'],env.TRADE_INGEST_SECRET)) return res.status(401).json({error:'Geçersiz veri adaptörü kimliği.'});
      if (!env.TRADE_LICENSED_SOURCE) return res.status(503).json({error:'Lisanslı veri kaynağı sunucuda tanımlanmamış.'});
      try {
        const result=await processBatch(getDb(),req.body,{source:env.TRADE_LICENSED_SOURCE,licensed:true,env,now});
        return res.json({ok:true,...result});
      } catch (error) {
        if (/gönderin|gerekli|geçerli|kabul|olmalı|mum|sembol/i.test(error.message)) return res.status(400).json({error:error.message});
        console.error('[trade-ingest] Veri işlenemedi.');
        return res.status(503).json({error:'Trade verisi kaydedilemedi; veri tabloları ve adaptör kontrol edilmeli.'});
      }
    }
    if (!((req.method==='GET' && ['state','history'].includes(action)) || (req.method==='POST' && action==='preferences'))) return res.status(400).json({error:'Geçersiz işlem.'});
    const token=/^Bearer (.+)$/.exec(String(req.headers?.authorization ?? ''))?.[1];
    if (!token) return res.status(401).json({error:'Oturum açmanız gerekiyor.'});
    let sb;
    try { sb=getDb(); } catch { return res.status(503).json({error:'Sunucu veri bağlantısı kurulmamış.'}); }
    let auth,authError;
    try { ({data:auth,error:authError}=await sb.auth.getUser(token)); }
    catch { return res.status(503).json({error:'Oturum doğrulama hizmetine şu an ulaşılamıyor.'}); }
    if (authError || !auth?.user) return res.status(401).json({error:'Oturum açmanız gerekiyor.'});
    const userId=auth.user.id;
    if (action==='history') {
      try { return res.json(await readHistory(sb,{...req.query,now:now()})); }
      catch (error) { return res.status(error.statusCode===400?400:503).json({error:error.statusCode===400?error.message:'Geçmiş trade kayıtları şu an alınamıyor. Yeniden deneyin.'}); }
    }
    try {
      if (action==='preferences') {
        if (typeof req.body?.enabled!=='boolean') return res.status(400).json({error:'Bildirim tercihi açık veya kapalı olmalı.'});
        checked(await sb.from('trade_preferences').upsert({user_id:userId,enabled:req.body.enabled,updated_at:new Date(now()).toISOString()}));
        return res.json({preferences:{enabled:req.body.enabled}});
      }
      const [signals,monitor,prefs,candidatesResult,trackedResult]=await Promise.all([
        sb.from('trade_signals').select('data,updated_at').order('updated_at',{ascending:false}).limit(100),
        sb.from('monitor_status').select('updated_at,data').eq('id','trade').maybeSingle(),
        sb.from('trade_preferences').select('enabled').eq('user_id',userId).maybeSingle(),
        sb.from('candidates').select('symbol,market,data,updated_at').eq('horizon','short').order('updated_at',{ascending:false}).limit(50),
        sb.from('tracked_symbol_queue').select('symbol').order('symbol').limit(100),
      ]);
      let items=(checked(signals) ?? []).map((row)=>currentTradeItem(row.data,now()));
      const statusRow=checked(monitor), preferences=checked(prefs) ?? {enabled:false};
      const rows=checked(candidatesResult) ?? [];
      const covered=new Set([...items.map((item)=>item.symbol),...rows.map(candidateTradeSymbol)]);
      // Tracked companies remain visible even before the next candidate job.
      // Missing optional queue data must not hide existing candidate cards.
      for (const row of trackedResult?.data ?? []) {
        const symbol=String(row.symbol ?? '').toUpperCase();
        if (covered.size>=50) break;
        if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) || covered.has(symbol)) continue;
        rows.push({symbol,market:symbol.endsWith('.IS')?'BIST':'US',data:{companyName:symbol}});
        covered.add(symbol);
      }
      // Genuine existing candidates still explain missing live prerequisites in
      // a new installation; no demo stock is presented as a current trade.
      const seen=new Set(items.map((item)=>item.symbol));
      for (const row of rows) {
        const symbol=candidateTradeSymbol(row);
        if (!seen.has(symbol)) { items.push(buildResearchTradeItem(row,{now:now(),feedConfigured:Boolean(env.TRADE_LICENSED_SOURCE)}));seen.add(symbol); }
      }
      let research={items:[],refreshedCount:0};
      if (!env.TRADE_LICENSED_SOURCE && env.TRADE_RESEARCH_FALLBACK!=='false') {
        try {
          // A bounded, durable refresh works on Vercel with the PC switched off.
          // This path never certifies a live feed or sends trade notifications.
          research=await refreshResearch(sb,{rows,items,env,now:now(),limit:3});
          const updates=new Map((research.items ?? []).map((item)=>[item.symbol,currentTradeItem(item,now())]));
          items=items.map((item)=>updates.get(item.symbol) ?? item);
        } catch {
          research={items:[],refreshedCount:0,error:'Gün içi araştırma verisi yenilenemedi; son kayıtlar korunuyor.'};
        }
      }
      const monitorState=tradeMonitorState(statusRow,now());
      if (!monitorState.running) items=items.map((item)=>item.status!=='ready'?item:{...item,status:'blocked',
        blockers:[...(item.blockers ?? []),'Canlı veri bağlantısı sağlıklı değil; yeni doğrulanmış veri bekleniyor.'],
        scenarios:(item.scenarios ?? []).map((scenario)=>({...scenario,eligible:false}))});
      const status={...(statusRow?.data ?? {}),...monitorState,lastHeartbeatAt:statusRow?.updated_at ?? null,
        mode:statusRow?.data?.mode ?? (env.TRADE_LICENSED_SOURCE?'awaiting-feed':'unconfigured'),
        quoteMaxAgeMs:TRADE_QUOTE_MAX_AGE_MS,barMaxAgeMs:TRADE_BAR_MAX_AGE_MS,
        message:monitorState.running?statusRow.data.message:!env.TRADE_LICENSED_SOURCE
          ? 'Canlı trade veri kaynağı henüz bağlanmadı. Araştırma kartları gösterilir; canlı sinyal ve trade bildirimi üretilmez.'
          : 'Canlı veri kaynağı tanımlı ancak güncel veri alınamıyor. Yeni canlı trade bildirimi üretilmez.'};
      if (!env.TRADE_LICENSED_SOURCE && env.TRADE_RESEARCH_FALLBACK!=='false') {
        status.mode='delayed-research';
        status.source='Yahoo Finance · gün içi araştırma';
        status.researchAvailable=items.some((item)=>item.availability==='delayed-research');
        status.researchRefreshCount=research.refreshedCount ?? 0;
        status.message=research.error || (status.researchAvailable
          ? 'Fiyat ve kapanmış dakikalık mumlar buluttan alınır. Seviyeler zaman damgalı araştırma senaryolarıdır; canlı sinyal ve trade bildirimi değildir.'
          : 'İzlenen hisselerin fiyat ve dakikalık verileri buluttan sırayla alınıyor. Kaynak veri vermezse eksik alanlar açıkça gösterilir.');
        if (research.refreshedCount>0) status.lastCycleAt=new Date(now()).toISOString();
      }
      return res.json({items,status,preferences,serverTime:new Date(now()).toISOString(),
        requirements:tradeRequirements({licensedSource:env.TRADE_LICENSED_SOURCE,monitor:statusRow,pushReady:pushConfigured(),now:now(),items,hasContext:items.some((item)=>item.context?.candidate || item.context?.news?.length || item.context?.intelligence || item.context?.macroEvents?.length)})});
    } catch {
      console.error('[trade] Veri tabloları okunamadı.');
      return res.status(503).json({error:'Trade kurulumu tamamlanmamış veya veri hizmeti kullanılamıyor. Trade SQL migration ve adaptör kontrol edilmeli.'});
    }
  };
}

export default createTradeHandler();

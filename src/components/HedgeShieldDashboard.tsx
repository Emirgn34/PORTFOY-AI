import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check, ChevronRight, Clock3, Radar, RefreshCw, Shield, ShieldAlert, TrendingDown } from 'lucide-react';
import { enableShieldNotifications, hedgeRequest, type RadarState, type Regime } from '../services/hedgeRadar';

const META: Record<Regime, {label:string; className:string; description:string}> = {
  SAFE:{label:'Güvenli trend',className:'border-gain/30 bg-gain/5 text-gain',description:'Spot pozisyonları izle'},
  SUPPORT_TEST:{label:'SMA50 destek testi',className:'border-amber-400/30 bg-amber-400/5 text-amber-400',description:'Tepki bölgesi · teyit bekleniyor'},
  TRAP_WARNING:{label:'Tuzak ihtimali',className:'border-orange-400/30 bg-orange-400/5 text-orange-400',description:'Sarkma var · kırılım onaylanmadı'},
  HEDGE_TRIGGER:{label:'Hedge alarmı',className:'border-loss/40 bg-loss/5 text-loss',description:'Koruma senaryosunu değerlendir'},
  DEEP_VALUE_BUY:{label:'Ana destek bölgesi',className:'border-sky-400/30 bg-sky-400/5 text-sky-400',description:'Hedge azaltımı · kademeli spot senaryosu'},
};
const usd = (value:number) => new Intl.NumberFormat('tr-TR',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value);
const decimal = (value:number, digits=2) => new Intl.NumberFormat('tr-TR',{maximumFractionDigits:digits,minimumFractionDigits:digits}).format(value);
const pct = (value:number|null) => value == null ? '—' : `${value>0?'+':''}${decimal(value)}%`;
const dateTime = (value:string) => new Date(value).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul',dateStyle:'short',timeStyle:'short'});
type PushConfig = {configured:boolean;publicKey:string;subscriptions:{endpoint:string;topics:string[]}[]};

function DistanceBar({name,price,level}:{name:string;price:number;level:number|null}) {
  const distance = level ? (price/level-1)*100 : null;
  return <div className="space-y-1.5">
    <div className="flex justify-between gap-3 text-xs"><span className="text-slate-400">{name}</span>
      <span className={distance==null?'text-slate-500':distance<0?'text-loss':'text-gain'}>{pct(distance)}</span></div>
    <div className="relative h-1.5 overflow-hidden rounded-full bg-navy-700" role="meter" aria-label={name}
      aria-valuemin={-10} aria-valuemax={10} aria-valuenow={distance==null?undefined:Math.max(-10,Math.min(10,distance))}
      aria-valuetext={distance==null?'Yeterli geçmiş yok':`Desteğe uzaklık ${pct(distance)}`}>
      <div className={`h-full rounded-full ${distance!=null&&distance<0?'bg-loss/70':'bg-gain/70'}`}
        style={{width:`${distance==null?0:Math.max(0,Math.min(100,50+distance*5))}%`}} />
      <span className="absolute left-1/2 top-0 h-full w-px bg-slate-400" />
    </div>
    <p className="text-[10px] text-slate-500">Destek {level?`$${decimal(level)}`:'hesaplanamadı'} · orta çizgi %0</p>
  </div>;
}

export default function HedgeShieldDashboard() {
  const [state,setState]=useState<RadarState|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [requesting,setRequesting]=useState(false);
  const [pushConfig,setPushConfig]=useState<PushConfig|null>(null);
  const [pushBusy,setPushBusy]=useState(false);
  const [pushEnabled,setPushEnabled]=useState(false);
  const [message,setMessage]=useState('');
  const [amount,setAmount]=useState('');
  const [ratio,setRatio]=useState(0.5);
  const [clock,setClock]=useState(Date.now());
  const initialized=useRef(false);
  const mounted=useRef(true);
  const fetching=useRef(false);
  const supported=typeof window!=='undefined' && window.isSecureContext && 'Notification' in window &&
    'PushManager' in window && 'serviceWorker' in navigator;
  const load=useCallback(async()=>{
    if(fetching.current) return;
    fetching.current=true;
    try {
      const result=await hedgeRequest<{state:RadarState|null}>();
      if(!mounted.current) return;
      setState(result.state);setError('');
      if(result.state?.market_regime&&!initialized.current) {
        setAmount(result.state.portfolio_value_usd?.toFixed(0)??'');
        setRatio(result.state.hedge_recipe.hedge_ratio||0.5);initialized.current=true;
      }
    } catch(e) {if(mounted.current) setError(e instanceof Error?e.message:'Radar yüklenemedi.');}
    finally {fetching.current=false;if(mounted.current) setLoading(false);}
  },[]);
  useEffect(()=>{
    mounted.current=true;void load();
    void hedgeRequest<PushConfig>('/api/notifications/subscribe').then(async(config)=>{
      if(!mounted.current) return;
      setPushConfig(config);
      if(supported) {
        const registration=await navigator.serviceWorker.getRegistration('/');
        const current=await registration?.pushManager.getSubscription();
        if(mounted.current) setPushEnabled(config.subscriptions.some(s=>s.endpoint===current?.endpoint&&s.topics.includes('hedge-radar')));
      }
    }).catch(()=>{});
    const timer=setInterval(()=>{setClock(Date.now());void load();},30_000);
    return()=>{mounted.current=false;clearInterval(timer);};
  },[load,supported]);
  async function refresh() {
    setRequesting(true);setMessage('');
    try {const result=await hedgeRequest<{message:string}>('/refresh','POST');setMessage(result.message);await load();}
    catch(e) {setMessage(e instanceof Error?e.message:'Analiz başlatılamadı.');}
    finally {setRequesting(false);}
  }
  async function subscribe() {
    if(!pushConfig?.configured) return;
    setPushBusy(true);setMessage('');
    try {await enableShieldNotifications(pushConfig);setPushEnabled(true);setMessage('Kalkan bildirimleri bu cihazda etkinleştirildi.');}
    catch(e) {setMessage(e instanceof Error?e.message:'Bildirimler açılamadı.');}
    finally {setPushBusy(false);}
  }
  const ready=state?.market_regime?state:null;
  const meta=ready?META[ready.market_regime!]:null;
  const stale=ready?.diagnostics.market_open && clock-Date.parse(ready.diagnostics.as_of)>45*60_000;
  const parsedAmount=Number(amount);
  const total=Number.isFinite(parsedAmount)?Math.min(1e12,Math.max(0,parsedAmount)):0;
  const queueExpired=state?.refresh_status==='queued' && Boolean(state.refresh_requested_at) &&
    clock-Date.parse(state.refresh_requested_at!)>15*60_000;
  const queued=state?.refresh_status==='queued'&&!queueExpired;
  const recipe=ready?.hedge_recipe;
  const alternatives=ready&&recipe?[
    {ticker:'SQQQ',leverage:3,beta:ready.portfolio_beta,base:'Nasdaq-100'},
    {ticker:'SOXS',leverage:3,beta:recipe.soxx_beta,base:'Yarı iletken · SOXX vekili'},
    {ticker:'PSQ',leverage:1,beta:ready.portfolio_beta,base:'Nasdaq-100'},
    {ticker:'SH',leverage:1,beta:recipe.spy_beta,base:'S&P 500'},
  ]:[];
  return <section id="hedge-shield" aria-label="Portföy Kalkanı ve Hedge Radarı" className="scroll-mt-6 rounded-xl border border-navy-700 bg-navy-900">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-navy-700 p-5">
      <div className="flex items-center gap-3"><div className="rounded-xl border border-accent/20 bg-accent/10 p-2.5 text-accent"><Shield size={23}/></div>
        <div><h2 className="font-semibold text-ink">Portföy Kalkanı & Hedge Radarı</h2>
          <p className="mt-1 text-xs text-slate-500">Destekler, tuzak filtresi ve portföyüne özel koruma senaryoları</p></div></div>
      <div className="flex flex-wrap gap-2">
        <button onClick={refresh} disabled={requesting||queued} className="flex items-center gap-2 rounded-lg border border-navy-600 px-3 py-2 text-xs text-ink disabled:opacity-50">
          <RefreshCw size={14} className={requesting||queued?'animate-spin':''}/>
          {queued?'Analiz sırada':requesting?'Başlatılıyor…':'Şimdi Analiz Et'}</button>
        <button onClick={subscribe} disabled={!supported||!pushConfig?.configured||pushBusy||pushEnabled} className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-on-accent disabled:opacity-50">
          {pushEnabled?<Check size={14}/>:<Bell size={14}/>}{pushEnabled?'Kalkan bildirimleri etkin':pushBusy?'Etkinleştiriliyor…':'Bildirimleri Aktif Et'}</button>
      </div>
    </div>
    <div className="space-y-5 p-5">
      {message&&<p role="status" className="rounded-lg bg-accent/5 p-3 text-xs text-accent-soft">{message}</p>}
      {error&&<p role="alert" className="text-xs text-amber-400">{error}{ready?' Son başarılı analiz gösteriliyor.':''}</p>}
      {queueExpired&&<p role="alert" className="text-xs text-amber-400">Analiz kuyruğu 15 dakikadır tamamlanmadı. Yeniden başlatabilir veya iş akışını kontrol edebilirsin.</p>}
      {loading&&!ready?<p role="status" className="text-sm text-slate-400">Kalkan durumu yükleniyor…</p>:!ready?<div className="rounded-lg border border-dashed border-navy-600 p-6 text-sm text-slate-400">
        İlk kalkan analizi bekleniyor. SQL ve hesap kurulumu tamamlandıktan sonra “Şimdi Analiz Et” ile başlatabilirsin.
      </div>:<>
        <div className={`rounded-xl border p-4 ${stale?'border-amber-400/30 bg-amber-400/5 text-amber-400':meta!.className}`}>
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><ShieldAlert size={18}/>
            <h3 className="font-semibold">{stale?'Veri gecikti · yeni sinyal bekleniyor':meta!.label}</h3></div>
            <span className="text-xs">{ready.diagnostics.market_open?'ABD seansı açık':'Piyasa kapalı · son seans'}</span></div>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{stale?'Güncel fiyat alınana kadar bu reçeteyi aktif sinyal olarak kullanma.':ready.recommended_action}</p>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500"><Clock3 size={12}/>
            Veri: {dateTime(ready.diagnostics.as_of)} · Kapanış penceresi {ready.diagnostics.close_window_tr} TR
            {ready.previous_regime&&<span>· Önceki: {META[ready.previous_regime]?.label??ready.previous_regime}</span>}</p>
        </div>
        {ready.diagnostics.fallback_portfolio&&<p className="text-xs text-amber-400">Portföy boş: varsayılan sekiz hisse eşit ağırlıklı izleniyor. Bu beta kişisel portföy betası değildir.</p>}
        {ready.refresh_error&&<p role="alert" className="text-xs text-amber-400">{ready.refresh_error}</p>}
        <div className="grid gap-4 lg:grid-cols-3">
          {[{ticker:'QQQ',price:ready.qqq_price,sma:ready.qqq_sma50,ema20:ready.qqq_weekly_ema20,ema50:ready.qqq_weekly_ema50},
            {ticker:'SOXX',price:ready.soxx_price,sma:ready.soxx_sma50,ema20:ready.soxx_weekly_ema20,ema50:ready.soxx_weekly_ema50}].map(index=><div key={index.ticker} className="space-y-4 rounded-xl border border-navy-700 bg-navy-850/40 p-4">
              <div className="flex justify-between text-sm"><span className="font-semibold text-ink">{index.ticker}</span><span className="tabular-nums text-ink">${decimal(index.price)}</span></div>
              <DistanceBar name={`${index.ticker} günlük SMA50`} price={index.price} level={index.sma}/>
              <DistanceBar name={`${index.ticker} haftalık EMA20`} price={index.price} level={index.ema20}/>
              <DistanceBar name={`${index.ticker} haftalık EMA50`} price={index.price} level={index.ema50}/>
            </div>)}
          <div className="space-y-4 rounded-xl border border-navy-700 p-4"><div className="flex justify-between text-sm"><span className="font-semibold text-ink">Tuzak filtresi</span><TrendingDown size={17} className="text-slate-500"/></div>
            <div className="flex justify-between text-xs text-slate-400"><span>VIX</span><span className="text-ink">{decimal(ready.vix_level)} <span className="text-slate-500">({pct(ready.vix_change_pct)})</span></span></div>
            <div className="flex justify-between text-xs text-slate-400"><span>QQQ ATR14</span><span className="text-ink">${decimal(ready.qqq_atr)}</span></div>
            {[['Kapanış / ekstrem panik',ready.diagnostics.time_confirmed],['ATR tamponu aşıldı',ready.diagnostics.atr_confirmed],
              [`Hacim ≥ 1,10× (${decimal(ready.diagnostics.volume_ratio)}×)`,ready.diagnostics.volume_confirmed]].map(([label,ok])=><div key={String(label)} className="flex items-center justify-between gap-2 text-xs"><span className="text-slate-400">{label}</span><span className={ok?'text-gain':'text-slate-500'}>{ok?'Onaylı':'Bekliyor'}</span></div>)}
            <p className="text-[11px] text-slate-500">Haftalık EMA20 altı, bağımsız yapısal risk sinyalidir.</p>
          </div>
        </div>
        <div className="rounded-xl border border-accent/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-ink">Midas hedge senaryoları</h3>
            <p className="mt-1 text-xs text-slate-500">60 ortak işlem günü · QQQ betası <strong className="text-accent-soft">β {decimal(ready.portfolio_beta)}</strong> · Aktif koruma kademesi %{recipe!.hedge_ratio*100}</p></div>
            <span className="text-xs text-slate-400">Stop takibi: QQQ ${decimal(ready.qqq_sma50)} üstü günlük kapanış</span></div>
          <div className="my-4 flex flex-wrap items-end gap-4"><label className="space-y-1 text-xs text-slate-400"><span className="block">Korunacak ABD spot portföyü (USD)</span>
            <input type="number" min="0" max="1000000000000" value={amount} onChange={e=>setAmount(e.target.value)} className="w-56 rounded-lg border border-navy-600 bg-navy-850 px-3 py-2 text-sm text-ink" placeholder="Portföy tutarı"/></label>
            <label className="space-y-1 text-xs text-slate-400"><span className="block">İncelenen koruma oranı</span><select aria-label="Koruma oranı" value={ratio} onChange={e=>setRatio(Number(e.target.value))} className="rounded-lg border border-navy-600 bg-navy-850 px-3 py-2 text-sm text-ink"><option value={0.5}>%50</option><option value={1}>%100</option></select></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{alternatives.map(item=>{
            const percent=Math.max(0,item.beta)*ratio/item.leverage*100;
            return <div key={item.ticker} className="rounded-lg border border-navy-700 bg-navy-850/50 p-3"><div className="flex justify-between text-xs"><strong className="text-ink">{item.ticker}</strong><span className="text-slate-500">−{item.leverage}× günlük</span></div>
              <p className="mt-2 text-xl font-semibold tabular-nums text-accent-soft">%{decimal(percent)}</p><p className="mt-1 text-sm text-ink">{total?usd(total*percent/100):'Tutar gir'}</p>
              <p className="mt-2 text-[10px] text-slate-500">{item.base} · β {decimal(item.beta)}</p>{percent>100&&<p className="mt-1 text-[10px] text-amber-400">Portföy tutarından fazla nakit gerektirir.</p>}</div>;
          })}</div>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">{recipe!.note} Emir gönderilmez; Midas erişimi ve işlem koşulları ayrıca kontrol edilir.</p>
        </div>
        <div><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink"><Radar size={16}/> Hisse bazlı destek radarı</h3>
          <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="border-b border-navy-700 text-slate-500"><tr>
            {['Hisse','Fiyat','SMA50 mesafe','Haftalık EMA20','Aylık EMA100','Destek notu'].map(h=><th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead><tbody>{ready.stock_radar.map(stock=><tr key={stock.ticker} className="border-b border-navy-800 last:border-0">
              <td className="px-3 py-3 font-semibold text-ink">{stock.ticker}<span className={`mt-1 block text-[10px] font-normal ${stock.status==='BELOW_SUPPORT'?'text-loss':'text-gain'}`}>{stock.status==='BELOW_SUPPORT'?'Destek altında':stock.status==='SUPPORT_TEST'?'Destek testi':'Destek üstünde'}</span></td>
              <td className="px-3 py-3 text-slate-300">${decimal(stock.price)}</td>
              {[stock.sma50_distance_pct,stock.weekly_ema20_distance_pct,stock.monthly_ema100_distance_pct].map((value,i)=><td key={i} className={`px-3 py-3 tabular-nums ${value==null?'text-slate-500':value<0?'text-loss':'text-gain'}`}>{pct(value)}
                <span className="mt-1 block text-[10px] text-slate-500">{[stock.sma50,stock.weekly_ema20,stock.monthly_ema100][i]!=null?`$${decimal([stock.sma50,stock.weekly_ema20,stock.monthly_ema100][i]!)}`:'Yeterli geçmiş yok'}</span></td>)}
              <td className="max-w-xs px-3 py-3 leading-relaxed text-slate-500">{stock.note}</td></tr>)}</tbody></table></div>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">{ready.diagnostics.price_source}. Haftalık ve aylık destekler tamamlanmış mumlardan hesaplanır. β ve hedge yüzdeleri geçmiş ilişkilere dayalı nominal senaryolardır; koruma sonucu garanti edilmez.</p>
      </>}
      {!supported&&<p className="flex items-center gap-1 text-[11px] text-slate-500"><ChevronRight size={12}/>Bildirim için HTTPS ve desteklenen tarayıcı gerekir. iPhone’da iOS 16.4+ ile ana ekrana eklenen uygulamayı aç.</p>}
    </div>
  </section>;
}

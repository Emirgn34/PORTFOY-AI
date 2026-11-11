import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check, ChevronRight, Clock3, HelpCircle, Radar, RefreshCw, Shield, ShieldAlert, TrendingDown } from 'lucide-react';
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

/**
 * "Neden bu sinyal?" — telefona düşen bildirim (recommended_action) hangi
 * ölçümlerden doğdu, sayfada SAYILARLA açıklanır. Kullanıcı bildirimden
 * gelince "SOXS/SQQQ neden mantıklı (ya da neden değil)" sorusunun cevabını
 * tahmin etmek zorunda kalmaz. Yeni veri üretmez; eldeki radar durumundan
 * türetilir, bu yüzden ek maliyeti yoktur.
 */
function buildWhy(ready: RadarState): string[] {
  const d = ready.diagnostics;
  const r = ready.hedge_recipe;
  const sma = ready.qqq_sma50;
  const smaDist = sma ? (ready.qqq_price / sma - 1) * 100 : null;
  const soxxBelow = ready.soxx_sma50 ? ready.soxx_price < ready.soxx_sma50 : false;
  const why: string[] = [];
  const fmtPct = (v: number | null) => (v == null ? '—' : `%${decimal(Math.abs(v), 1)}`);

  switch (ready.market_regime) {
    case 'HEDGE_TRIGGER':
      why.push(
        d.weekly_break
          ? `QQQ ($${decimal(ready.qqq_price)}), haftalık EMA20 desteğinin ($${decimal(ready.qqq_weekly_ema20)}) ALTINDA — tek başına yeterli sayılan yapısal kırılım sinyali.`
          : `QQQ ($${decimal(ready.qqq_price)}), günlük SMA50 desteğinin ($${decimal(sma)}) ${fmtPct(smaDist)} altında ve kırılım üç filtreden geçti.`
      );
      why.push(
        d.atr_confirmed
          ? `ATR tamponu aşıldı: fiyat, "gürültü" sayılan bölgenin (SMA50 − 0,4×ATR${d.break_level ? ` ≈ $${decimal(d.break_level)}` : ''}) altında.`
          : 'ATR tamponu henüz aşılmadı (haftalık kırılım bu onayı beklemez).'
      );
      why.push(
        `İşlem hacmi 20 günlük ortalamanın ${decimal(d.volume_ratio)}× katı (eşik 1,10×) — hareketin arkasında gerçek satış ${d.volume_confirmed ? 'VAR' : 'henüz teyitsiz'}.`
      );
      if (d.panic) why.push(`VIX ${decimal(ready.vix_level)} (>22) ve QQQ günü %2,5'ten sert düşüşte: ekstrem panik koşulu, kapanış beklenmedi.`);
      why.push(
        soxxBelow
          ? `SOXX kendi SMA50'sinin ($${decimal(ready.soxx_sma50)}) altında: çip tarafı endeksten de zayıf. Çip ağırlıklı portföyde SOXS alternatifi bu yüzden öne çıkıyor (SOXX betan β ${decimal(r.soxx_beta)}).`
          : `SOXX hâlâ kendi SMA50'sinin üstünde: sektör kırılımı yok, QQQ bazlı koruma (SQQQ/PSQ) genelde yeterli.`
      );
      why.push(`Önerilen koruma kademesi %${r.hedge_ratio * 100}: ${d.weekly_break ? 'haftalık yapısal kırılım' : soxxBelow ? 'endeks + sektör kırılımı birlikte' : 'yalnızca günlük kırılım'} olduğu için.`);
      why.push(`Çıkış kuralı: QQQ, SMA50 ($${decimal(r.stop_level)}) üstünde GÜNLÜK kapanış yaparsa koruma senaryosu kapanır.`);
      break;
    case 'DEEP_VALUE_BUY':
      why.push(`QQQ ($${decimal(ready.qqq_price)}), haftalık EMA50 ana destek bölgesinin ($${decimal(ready.qqq_weekly_ema50)}) %1,5 bandı içinde.`);
      why.push('Bu bölge tarihsel olarak güçlü tepki alanıdır: yeni hedge AÇMAK yerine mevcut hedge kârını realize edip güçlü hisselere kademeli dönüş senaryosu izlenir ("SOXL/spot mantıklı olabilir" bildirimlerinin kaynağı budur).');
      why.push(`VIX ${decimal(ready.vix_level)} (${pct(ready.vix_change_pct)}) — panik seviyesi dip bölgelerinde tepe yapma eğilimindedir. Bu seviye dip GARANTİSİ değildir; kademeli hareket önerilir.`);
      break;
    case 'TRAP_WARNING': {
      why.push(`QQQ ($${decimal(ready.qqq_price)}), SMA50 desteğinin ($${decimal(sma)}) ${fmtPct(smaDist)} altında sarkıyor ama kırılım ONAYSIZ — ayı tuzağı olabilir.`);
      const missing: string[] = [];
      if (!d.time_confirmed) missing.push(`kapanış penceresi teyidi (${d.confirmation_tr} kapanışı beklenir)`);
      if (!d.atr_confirmed) missing.push('ATR tamponu aşımı (fiyat hâlâ gürültü bandında)');
      if (!d.volume_confirmed) missing.push(`hacim teyidi (şu an ${decimal(d.volume_ratio)}×, eşik 1,10×)`);
      if (missing.length) why.push(`Eksik onaylar: ${missing.join(' · ')}. Bu yüzden hedge ÖNERİLMEDİ.`);
      why.push('Onaysız kırılımda pozisyon açmak, tuzak dönüşünde iki yönde de zarar ettirir; sistem bilerek bekliyor.');
      break;
    }
    case 'SUPPORT_TEST':
      why.push(`QQQ ($${decimal(ready.qqq_price)}), SMA50 desteğinin ($${decimal(sma)}) hemen üstünde (${fmtPct(smaDist)} mesafe, 0–1,2% bandı) — karar bölgesi.`);
      why.push('Destek tutarsa tepki alımı senaryosu; aşağı kırılırsa zaman + ATR + hacim onayı aranır. Şu an iki yönde de işlem sinyali yok.');
      break;
    default:
      why.push(`QQQ ($${decimal(ready.qqq_price)}), SMA50'nin ($${decimal(sma)}) ${fmtPct(smaDist)} üstünde ve haftalık EMA20 üstünde: trend sağlıklı.`);
      why.push(`VIX ${decimal(ready.vix_level)} (${pct(ready.vix_change_pct)}) — koruma maliyeti ödemeyi gerektiren bir stres yok; spot pozisyonlar izlenir.`);
  }
  return why;
}

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
    // Sekme arka plandayken yoklama DURUR (TradePage'deki görünürlük deseni):
    // açık unutulan sekme gün boyu Supabase okuması ve batarya harcamasın.
    let timer: ReturnType<typeof setInterval>|null = setInterval(()=>{void load();},30_000);
    const visibility=()=>{
      if(document.visibilityState==='hidden'){ if(timer){clearInterval(timer);timer=null;} }
      else if(!timer){ void load(); timer=setInterval(()=>{void load();},30_000); }
    };
    document.addEventListener('visibilitychange',visibility);
    const clockTimer=setInterval(()=>setClock(Date.now()),1000);
    return()=>{mounted.current=false;if(timer)clearInterval(timer);clearInterval(clockTimer);document.removeEventListener('visibilitychange',visibility);};
  },[load,supported]);
  async function refresh() {
    setRequesting(true);setMessage('');
    try {const result=await hedgeRequest<{message:string}>('/refresh','POST');setMessage(result.message);await load();}
    catch(e) {setMessage(e instanceof Error?e.message:'Analiz başlatılamadı.');await load();}
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
  const marketWindows=ready?[
    [ready.diagnostics.market_open_at,ready.diagnostics.market_close],
    [ready.diagnostics.next_market_open,ready.diagnostics.next_market_close],
  ].filter(([open,close])=>open&&close):[];
  const marketOpen=marketWindows.length?marketWindows.some(([open,close])=>clock>=Date.parse(open!)&&clock<Date.parse(close!)):
    Boolean(ready?.diagnostics.market_open && (!ready.diagnostics.market_close || clock<Date.parse(ready.diagnostics.market_close)));
  const calendarOld=Boolean(ready?.diagnostics.next_market_close&&clock>Date.parse(ready.diagnostics.next_market_close));
  const stale=calendarOld||(marketOpen&&clock-Date.parse(ready!.diagnostics.as_of)>45*60_000);
  const parsedAmount=Number(amount);
  const total=Number.isFinite(parsedAmount)?Math.min(1e12,Math.max(0,parsedAmount)):0;
  const activeJob=state?.refresh_status==='queued'||state?.refresh_status==='running';
  const deadline=state?.refresh_deadline_at || state?.refresh_started_at || state?.refresh_requested_at;
  const queueExpired=activeJob && Boolean(deadline) &&
    clock-Date.parse(deadline!)>(state?.refresh_deadline_at?0:15*60_000);
  const queued=activeJob&&!queueExpired;
  const retrySeconds=state?.refresh_retry_at ? Math.max(0,Math.ceil((Date.parse(state.refresh_retry_at)-clock)/1000)) : 0;
  const jobUrl=state?.refresh_run_url && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(state.refresh_run_url)
    ? state.refresh_run_url : null;
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
        <button onClick={refresh} disabled={requesting||queued||retrySeconds>0} className="flex items-center gap-2 rounded-lg border border-navy-600 px-3 py-2 text-xs text-ink disabled:opacity-50">
          <RefreshCw size={14} className={requesting||queued?'animate-spin':''}/>
          {queued?state?.refresh_status==='running'?'Analiz çalışıyor':'Analiz sırada':requesting?'Başlatılıyor…':retrySeconds>0?`${retrySeconds} sn sonra yeniden analiz`:'Şimdi Analiz Et'}</button>
        <button onClick={subscribe} disabled={!supported||!pushConfig?.configured||pushBusy||pushEnabled} className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-on-accent disabled:opacity-50">
          {pushEnabled?<Check size={14}/>:<Bell size={14}/>}{pushEnabled?'Kalkan bildirimleri etkin':pushBusy?'Etkinleştiriliyor…':'Bildirimleri Aktif Et'}</button>
      </div>
    </div>
    <div className="space-y-5 p-5">
      {message&&<p role="status" className="rounded-lg bg-accent/5 p-3 text-xs text-accent-soft">{message}</p>}
      {error&&<p role="alert" className="text-xs text-amber-400">{error}{ready?' Son başarılı analiz gösteriliyor.':''}</p>}
      {queued&&<p role="status" className="text-xs text-slate-400">{state?.refresh_status==='running'?'Analiz işi çalışıyor; son başarılı sonuç aşağıda korunuyor.':'Analiz isteği alındı; işin başlaması bekleniyor.'}</p>}
      {queueExpired&&<p role="alert" className="text-xs text-amber-400">Analiz 15 dakika içinde tamamlanmadı. Yeniden başlatabilirsiniz.</p>}
      {state?.refresh_error&&<p role="alert" className="text-xs text-amber-400">{state.refresh_error}</p>}
      {jobUrl&&<a href={jobUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-accent">Analiz işinin ayrıntılarını aç ↗</a>}
      {loading&&!ready?<p role="status" className="text-sm text-slate-400">Kalkan durumu yükleniyor…</p>:!ready?<div className="rounded-lg border border-dashed border-navy-600 p-6 text-sm text-slate-400">
        İlk kalkan analizi bekleniyor. SQL ve hesap kurulumu tamamlandıktan sonra “Şimdi Analiz Et” ile başlatabilirsin.
      </div>:<>
        <div className={`rounded-xl border p-4 ${stale?'border-amber-400/30 bg-amber-400/5 text-amber-400':meta!.className}`}>
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><ShieldAlert size={18}/>
            <h3 className="font-semibold">{stale?'Veri gecikti · yeni sinyal bekleniyor':meta!.label}</h3></div>
            <span className="text-xs">{calendarOld?'Seans takvimi güncellemesi bekleniyor':marketOpen?'ABD seansı açık':'Piyasa kapalı · son seans'}</span></div>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{stale?'Güncel fiyat alınana kadar bu reçeteyi aktif sinyal olarak kullanma.':ready.recommended_action}</p>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500"><Clock3 size={12}/>
            Veri: {dateTime(ready.diagnostics.as_of)} · Kapanış penceresi {ready.diagnostics.close_window_tr} TR
            {ready.previous_regime&&<span>· Önceki: {META[ready.previous_regime]?.label??ready.previous_regime}</span>}</p>
        </div>
        <div className="rounded-xl border border-navy-700 bg-navy-850/40 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><HelpCircle size={16} className="text-accent-soft"/> Neden bu sinyal?</h3>
          <p className="mt-1 text-[11px] text-slate-500">Telefona giden bildirim metni yukarıdaki öneridir; aşağıdaki maddeler o önerinin hangi ölçümlerden doğduğunu gösterir.</p>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-300">
            {buildWhy(ready).map((reason,i)=><li key={i} className="flex gap-2"><span className="mt-0.5 shrink-0 text-accent">•</span><span>{reason}</span></li>)}
          </ul>
        </div>
        {ready.diagnostics.fallback_portfolio&&<p className="text-xs text-amber-400">Portföy boş: varsayılan sekiz hisse eşit ağırlıklı izleniyor. Bu beta kişisel portföy betası değildir.</p>}
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

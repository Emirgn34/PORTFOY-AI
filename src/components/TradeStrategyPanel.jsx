const STATES = { waiting: 'Veri / yapı bekleniyor', watch: 'Yapı izleniyor', zone: 'Giriş bölgesinde', confirmed: 'Mum teyidi görüldü', invalidated: 'Yapı geçersizleşti' };
const format = (value) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('tr-TR', { maximumFractionDigits: 4 }) : '—';
const price = (value, currency) => `${format(value)} ${currency || ''}`.trim();
function sourceLink(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : undefined; } catch { return undefined; }
}

function StrategyChart({ chart, title }) {
  const bars = (chart?.bars ?? []).filter((bar) => Number.isFinite(Date.parse(bar.time)) && [bar.open,bar.high,bar.low,bar.close].every((value)=>Number.isFinite(value) && value>0));
  if (bars.length<2) return null;
  const lines = (chart.lines ?? []).filter((line)=>[line.from,line.to].every((point)=>Number.isFinite(Date.parse(point?.time)) && Number.isFinite(point?.price) && point.price>0));
  const times = [...bars.map((bar)=>Date.parse(bar.time)),...lines.flatMap((line)=>[Date.parse(line.from.time),Date.parse(line.to.time)])];
  const values = [...bars.flatMap((bar)=>[bar.low,bar.high]),...lines.flatMap((line)=>[line.from.price,line.to.price])];
  const left=Math.min(...times), right=Math.max(...times), bottom=Math.min(...values), top=Math.max(...values);
  const x=(time)=>12+(Date.parse(time)-left)/Math.max(1,right-left)*576;
  const y=(value)=>184-(value-bottom)/Math.max(0.000001,top-bottom)*168;
  const width=Math.min(5,500/bars.length);
  return <figure className="mt-4 rounded-lg border border-navy-700 bg-navy-900 p-2">
    <svg viewBox="0 0 600 200" role="img" aria-label={`${title}: kapanmış mumlar ve hesaplanan seviyeler`} className="w-full">
      {bars.map((bar)=><g key={bar.time} stroke={bar.close>=bar.open?'#34d399':'#fb7185'} fill={bar.close>=bar.open?'#34d399':'#fb7185'}><line x1={x(bar.time)} y1={y(bar.high)} x2={x(bar.time)} y2={y(bar.low)} strokeWidth="1" /><rect x={x(bar.time)-width/2} y={Math.min(y(bar.open),y(bar.close))} width={width} height={Math.max(1,Math.abs(y(bar.open)-y(bar.close)))} strokeWidth="0" /></g>)}
      {lines.map((line,index)=><g key={`${line.label}-${index}`}><line x1={x(line.from.time)} y1={y(line.from.price)} x2={x(line.to.time)} y2={y(line.to.price)} stroke={line.kind==='stop'?'#fb7185':line.kind==='target'?'#34d399':'#67e8f9'} strokeWidth="1.5" strokeDasharray={line.kind==='channel'?undefined:'5 4'} /><text x={Math.min(500,x(line.to.time))} y={Math.max(11,y(line.to.price)-4)} fill="#cbd5e1" fontSize="9">{line.label}</text></g>)}
    </svg>
    <figcaption className="px-2 pb-1 text-[11px] text-slate-500">Son kapanmış mumlar. Çizgiler belirtilen kurallarla hesaplanır; gelecekteki fiyat hareketini göstermez.</figcaption>
  </figure>;
}

function Setup({ setup, currency }) {
  const levels=setup.levels;
  return <div className="mt-3 rounded-lg border border-navy-700 bg-navy-900 p-3">
    <p className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold text-ink">{setup.direction==='short'?'Short / düşüş':setup.direction==='long'?'Long / yükseliş':setup.title || 'Kurulum'}</span><span className="text-amber-400">{STATES[setup.state] || 'İzlemede'}</span></p>
    {levels && <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4"><div><dt className="text-slate-400">Giriş bölgesi</dt><dd className="mt-1 text-ink">{price(levels.entryLow,currency)} – {price(levels.entryHigh,currency)}</dd></div><div><dt className="text-slate-400">Geçersizlik / stop</dt><dd className="mt-1 text-loss">{price(levels.stopLoss,currency)}</dd></div><div><dt className="text-slate-400">Koşullu hedef</dt><dd className="mt-1 text-gain">{price(levels.targetPrice,currency)}</dd></div><div><dt className="text-slate-400">Brüt getiri / risk</dt><dd className="mt-1 text-ink">{format(levels.rewardRisk)}×</dd></div></dl>}
    {(setup.reasons ?? []).length>0 && <ul className="mt-3 space-y-1 text-xs leading-relaxed text-slate-400">{setup.reasons.map((reason,index)=><li key={index}>{reason}</li>)}</ul>}
    {setup.direction==='short' && levels && <p className="mt-2 text-[11px] text-slate-500">Short senaryosunda borçlanma, teminat ve taşıma maliyeti ayrıca değerlendirilmelidir.</p>}
  </div>;
}

export default function TradeStrategyPanel({ strategies, currency, liveVerified=false }) {
  if (!Array.isArray(strategies) || !strategies.length) return null;
  return <section aria-label="Video stratejileri" className="space-y-3">
    <div><h3 className="font-semibold text-ink">Kanal ve Fibonacci stratejileri</h3><p className="mt-1 text-xs leading-relaxed text-slate-400">İki paylaşımdaki görsel örnekler, aşağıdaki açık kurallarla taranır. {liveVerified?'Canlı fiyat teyidi ana trade planında ayrıca değerlendirilir.':'Bu veriyle emir veya canlı sinyal oluşturulmaz.'} Mum teyidi, gelecekteki başarı olasılığı değildir. Brüt oranlar spread ve maliyet içermez.</p></div>
    {strategies.map((strategy)=><article key={strategy.id} className="rounded-xl border border-navy-700 bg-navy-850 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><h4 className="text-sm font-semibold text-ink">{strategy.title}</h4>{sourceLink(strategy.sourceUrl) && <a href={sourceLink(strategy.sourceUrl)} target="_blank" rel="noopener noreferrer" className="text-xs text-accent underline underline-offset-2">Kaynak video</a>}</div>
      <p className="mt-1 text-[11px] text-slate-500">Mum zamanı: {Number.isFinite(Date.parse(strategy.lastBarTime)) ? new Date(strategy.lastBarTime).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'}) : 'Doğrulanamadı'}{strategy.dataStatus==='stale'?' · Geçmiş seans / eski veri':''}</p>
      {(strategy.setups ?? []).length ? <><p className="mt-3 text-xs text-amber-400">{STATES[strategy.state] || 'İzlemede'}</p><ul className="mt-2 space-y-1 text-xs text-slate-400">{(strategy.reasons ?? []).map((reason,index)=><li key={index}>{reason}</li>)}</ul></> : <Setup setup={strategy} currency={currency} />}
      {(strategy.setups ?? []).map((setup,index)=><Setup key={setup.id || setup.direction || index} setup={setup} currency={currency} />)}
      <StrategyChart chart={strategy.chart} title={strategy.title} />
      <details className="mt-3 text-xs text-slate-400"><summary className="cursor-pointer text-slate-300">Tarama kuralları ve varsayımlar</summary><ul className="mt-2 list-disc space-y-1 pl-4">{(strategy.assumptions ?? []).map((assumption,index)=><li key={index}>{assumption}</li>)}</ul><p className="mt-2">Video bir gösterimdir; sembol, süre ve risk performansı için doğrulanmış geçmiş test sağlamaz.</p></details>
    </article>)}
  </section>;
}

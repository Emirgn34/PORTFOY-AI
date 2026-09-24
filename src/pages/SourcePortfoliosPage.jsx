import { useEffect, useState } from 'react';
import { automationRequest } from '../services/automation.js';
import NotificationSettings from '../components/NotificationSettings.jsx';
import PortfolioSet from '../components/PortfolioSet.jsx';
import { RESEARCH_SOURCES } from '../data/researchSources.js';

export default function SourcePortfoliosPage() {
  const [data,setData] = useState(null), [error,setError] = useState('');
  useEffect(() => {
    let active=true;
    automationRequest('sources').then((d) => {if(active) setData(d);}).catch((e) => {if(active) setError(e.message);});
    return () => {active=false;};
  },[]);
  const run=data?.run?.data;
  return <div className="space-y-5">
    <section className="rounded-xl border border-navy-700 bg-navy-900 p-5 space-y-3">
      <h2 className="text-xl font-semibold text-ink">Yatırımcı Portföyleri</h2>
      <p className="text-sm text-slate-400">Dataroma yatırımcılarının iki yıllık takip simülasyonlarını karşılaştır. Veri kapsamı yeterli ilk beş yatırımcının hisseleri güncel algoritmayla dört ABD sepetine ayrılır. Kaynaklar her gün kontrol edilir; dağılım değiştiğinde bildirim gönderilir.</p>
      <p className="text-xs text-amber-400">Bu sıralama yatırımcıların gerçek fon getirisi değildir. Tarihçedeki ilk 20 hisse ve varsayımsal 60 günlük bildirim gecikmesi kullanılır. %95’ten az kapsam veya eksik fiyat geçmişi olan portföyler sıralanmaz.</p>
      <p className="text-xs text-slate-500">13F kayıtları çeyreklik ve gecikmelidir. Kaynak listesindeki araştırma, eğitim, politikacı ve yönetici işlemleri karşılaştırılabilir tam fon portföyleri değildir.</p>
      {data?.status && <p className="text-xs text-slate-500">Son kontrol: {new Date(data.status.updated_at).toLocaleString('tr-TR')}{data.status.data.error && ` · ${data.status.data.error}`}</p>}
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </section>
    <NotificationSettings />
    {run ? <>
      <section className="overflow-hidden rounded-xl border border-navy-700 bg-navy-900"><div className="p-4"><h3 className="font-semibold text-ink">İki yıllık takip karşılaştırması</h3><p className="mt-1 text-xs text-slate-400">{run.period.start} – {run.period.end} · USD · {run.checkedCount} kaynak portföy kontrol edildi</p></div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-y border-navy-700 text-xs text-slate-500"><tr>{['Yatırımcı','Simülasyon getirisi','En düşük kapsam','Son portföy tarihi'].map((s) => <th key={s} className="p-3">{s}</th>)}</tr></thead><tbody>{run.rankings.map((m) => <tr key={m.slug} className="border-b border-navy-800 text-slate-300"><td className="p-3"><a href={m.url} target="_blank" rel="noopener noreferrer" className="text-accent">{m.name} ↗</a>{m.selected && <span className="ml-2 text-xs">İzleniyor</span>}</td><td className="p-3">{m.returnPct > 0 ? '+' : ''}{m.returnPct}%</td><td className="p-3">%{m.coveragePct.toFixed(1)}</td><td className="p-3">{m.latestReportDate}</td></tr>)}</tbody></table></div><p className="p-4 text-xs leading-relaxed text-slate-500">{run.method}</p></section>
      <PortfolioSet portfolios={run.portfolios} />
      <details className="rounded-xl border border-navy-700 p-4 text-sm text-slate-400"><summary>Karşılaştırma dışı kalanlar ({run.excluded.length})</summary><ul className="mt-3 space-y-2">{run.excluded.map((m) => <li key={m.name}>{m.name}: {m.reason}</li>)}</ul></details>
    </> : <p className="rounded-xl border border-dashed border-navy-700 p-8 text-center text-sm text-slate-400">Henüz doğrulanmış iki yıllık karşılaştırma kaydı yok. Kaynak taraması tamamlandığında sıralama ve dört sepet burada görünecek.</p>}
    <details className="rounded-xl border border-navy-700 bg-navy-900 p-5"><summary className="cursor-pointer font-semibold text-ink">Paylaştığın 49 kaynak</summary><p className="mt-3 text-xs text-slate-500">Otomatik portföy karşılaştırması Dataroma ile bağlıdır. Diğer bağlantılar araştırma kütüphanesidir; otomatik izlendikleri anlamına gelmez. Resmî SEC bildirimleri ayrıca Araştırma Merkezi’ndedir.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{RESEARCH_SOURCES.map((s) => <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-navy-700 p-3"><p className="text-sm font-semibold text-accent">{s.name} ↗</p><p className="mt-1 text-xs text-slate-400">{s.description}</p><p className="mt-2 text-[10px] text-slate-500">{s.category}</p></a>)}</div></details>
  </div>;
}

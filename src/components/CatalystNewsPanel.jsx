import { useEffect, useState } from 'react';
import NotificationSettings from './NotificationSettings.jsx';
import { automationRequest } from '../services/automation.js';
export default function CatalystNewsPanel() {
  const [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true, loading = false;
    async function load() {
      if (loading) return; loading = true;
      try { const value = await automationRequest('catalysts'); if (active) { setData(value); setError(''); } }
      catch (e) { if (active) setError(e.message); } finally { loading = false; }
    }
    load(); const timer = setInterval(load, 15000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const fresh = data?.status && Date.now() - Date.parse(data.status.updated_at) < 90000;
  const live = fresh && data.status.data.mode === 'stream' && data.status.data.connected;
  const stale = data?.status && Date.now() - Date.parse(data.status.updated_at) > Math.max(90000, (data.status.data.intervalSeconds || 300) * 3000);
  return <div className="space-y-4">
    <div className="rounded-xl border border-navy-700 bg-navy-900 p-5">
      <h2 className="text-xl font-semibold text-ink">Hızlı Şirket Haberleri</h2>
      <p className="mt-2 text-sm text-slate-400">Gelir tahmini artışı, beklenti üstü bilanço, onay ve büyük sözleşme haberleri. ABD hisseleri; piyasa öncesi ve sonrası dahil.</p>
      <p className={`mt-3 text-xs ${live ? 'text-gain' : 'text-amber-400'}`}>{live ? 'Canlı haber bağlantısı etkin' : stale ? 'Haber kontrolü gecikti · son bağlantı güncel değil' : data?.status?.data?.mode === 'rss' ? data.status.data.connected ? 'Ücretsiz basın açıklamaları · aralıklı kontrol' : 'Ücretsiz haber kaynağına bağlantı kurulamadı' : data?.status?.data?.mode === 'scheduled' ? 'Zamanlanmış haber kontrolü · gerçek zamanlı bağlantı kapalı' : 'Haber bağlantısı kurulumu bekleniyor'}</p>
      {data?.status && <p className="mt-1 text-xs text-slate-500">Son kontrol: {new Date(data.status.updated_at).toLocaleString('tr-TR')}. {data.status.data.note}</p>}
      <p className="mt-2 text-xs text-slate-500">Bildirim, haber kaynağından alındığında gönderilir; fiyat hareketinden önce ulaşacağı garanti edilemez. Başlık sınıflandırmasıdır, işlem sinyali değildir. 15 dakikadan eski haberler geçmişte görünür; yeni bildirim gönderilmez.</p>
    </div>
    <NotificationSettings />
    {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    {!data ? <p className="text-sm text-slate-400">Haber akışı yükleniyor…</p> : !data.events.length ? <p className="rounded-xl border border-dashed border-navy-700 p-8 text-center text-sm text-slate-400">Henüz bu koşullarda kaydedilmiş bir haber yok.</p> : data.events.map((event) => <article id={event.id} key={event.id} className="rounded-xl border border-navy-700 bg-navy-900 p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full bg-accent/10 px-2 py-1 text-accent">{event.data.label}</span><span className="text-slate-500">{event.data.symbols.join(', ')} {event.data.timing && `· ${event.data.timing}`}</span></div>
      <h3 className="mt-3 font-semibold text-ink">{event.body}</h3><p className="mt-2 text-xs text-slate-500">{event.data.source} · Yayın: {new Date(event.published_at).toLocaleString('tr-TR')} · Algılama gecikmesi: {event.data.latencySeconds} sn</p>
      <a href={event.data.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm text-accent">Kaynak haberi aç ↗</a>
    </article>)}
  </div>;
}

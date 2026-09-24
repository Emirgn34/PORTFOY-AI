import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { automationRequest } from '../services/automation.js';

export default function NotificationSettings() {
  const [config, setConfig] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [topics, setTopics] = useState(['catalyst','source-portfolios']);
  const supported = typeof window !== 'undefined' && window.isSecureContext && 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data=await automationRequest('push');
        const registration=supported ? await navigator.serviceWorker.register('/sw.js') : null;
        const subscription=await registration?.pushManager.getSubscription();
        const stored=data.subscriptions?.find((item) => item.endpoint===subscription?.endpoint);
        if (active) { setConfig(data); setEnabled(Boolean(stored)); if (stored) setTopics(stored.topics); }
      } catch (error) { if (active) setMessage(error.message); }
    }
    load();
    return () => { active = false; };
  }, [supported]);
  async function subscribe() {
    setBusy(true); setMessage('');
    try {
      // İzin isteği doğrudan düğme tıklamasında; öncesinde ağ beklenmez (iOS).
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Bildirim izni verilmedi. Telefonunuzun site bildirim ayarlarından açabilirsiniz.');
      const registration = await navigator.serviceWorker.ready;
      const base64 = config.publicKey.replace(/-/g, '+').replace(/_/g, '/');
      const applicationServerKey = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      try { await automationRequest('push', { method: 'POST', body: { subscription: subscription.toJSON(), topics } }); }
      catch (error) { if (!existing) await subscription.unsubscribe(); throw error; }
      setEnabled(true); setMessage('Bildirim tercihleri kaydedildi.');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  async function unsubscribe() {
    setBusy(true); setMessage('');
    try {
      const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (subscription) {
        await automationRequest('push', { method: 'DELETE', body: { endpoint: subscription.endpoint } });
        await subscription.unsubscribe();
      }
      setEnabled(false); setMessage('Bu cihazda bildirimler kapatıldı.');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-navy-700 bg-navy-900 p-4 space-y-3" aria-label="Telefon bildirimleri">
    <h3 className="flex items-center gap-2 font-semibold text-ink"><Bell size={17} /> Telefon bildirimleri</h3>
    <p className="text-xs text-slate-400">Site kapalıyken de bildirim al. iPhone’da ana ekrana eklediğin uygulamadan aç (iOS 16.4 ve sonrası).</p>
    <div className="flex flex-wrap gap-4 text-sm text-slate-300">
      {[['catalyst', 'Hızlı şirket haberleri'], ['source-portfolios', 'Kaynak portföy yenilemeleri']].map(([key, label]) => <label key={key} className="flex items-center gap-2">
        <input type="checkbox" checked={topics.includes(key)} onChange={(e) => setTopics((current) => e.target.checked ? [...current, key] : current.filter((t) => t !== key))} />{label}
      </label>)}
    </div>
    {!supported ? <p className="text-xs text-amber-400">Bu tarayıcıda telefon bildirimi kullanılamıyor. HTTPS üzerinden, desteklenen tarayıcı veya ana ekran uygulamasını açın.</p>
      : config && !config.configured ? <p className="text-xs text-amber-400">Bildirim hizmetinin sunucu kurulumu bekleniyor.</p>
        : <div className="flex gap-3"><button disabled={busy || !config?.configured || !topics.length} onClick={subscribe} className="rounded-lg bg-accent px-4 py-2 text-sm text-on-accent disabled:opacity-50">{busy ? 'Kaydediliyor…' : enabled ? 'Bildirim tercihlerini kaydet' : 'Bildirimleri etkinleştir'}</button>
          {enabled && <button disabled={busy} onClick={unsubscribe} className="text-sm text-slate-400">Bildirimleri kapat</button>}</div>}
    {message && <p role="status" className="text-xs text-amber-400">{message}</p>}
  </section>;
}

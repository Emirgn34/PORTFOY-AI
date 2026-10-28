import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BarChart3, Download, Loader2, Share2 } from 'lucide-react';
import { formatCurrency } from '../utils/portfolioCalculations.js';
import { createPortfolioSharePng, getShareAllocation, renderPortfolioShareSvg, SHARE_COLORS } from '../utils/portfolioShare.js';

function SharePreview({ allocation }) {
  const [asset, setAsset] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [sharing, setSharing] = useState(false);
  const svg = useMemo(() => renderPortfolioShareSvg(allocation).svg, [allocation]);
  useEffect(() => {
    let active = true;
    let objectUrl;
    setAsset(null);
    setError('');
    createPortfolioSharePng(allocation).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      const file = new File([blob], 'portfoy-dagilimim.png', { type: 'image/png' });
      setAsset({ url: objectUrl, file });
    }).catch(() => { if (active) setError('Görsel hazırlanamadı. Tekrar deneyin.'); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [allocation, attempt]);

  let canShare = false;
  try { canShare = Boolean(asset && navigator.share && navigator.canShare?.({ files: [asset.file] })); } catch { /* Download remains available. */ }
  async function share() {
    if (!asset) return;
    setSharing(true);
    setError('');
    try {
      // PNG is prepared before this click, preserving the browser's user activation.
      await navigator.share({ files: [asset.file], title: 'Portföy dağılımım' });
    } catch (err) {
      if (err.name !== 'AbortError') setError('Paylaşım açılamadı. PNG indir seçeneğini kullanabilirsiniz.');
    } finally { setSharing(false); }
  }

  return (
    <div className="space-y-4">
      <img className="mx-auto w-full max-w-[320px] rounded-2xl border border-teal-300/15 shadow-xl" draggable={false} src={asset?.url ?? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt="Portföy paylaşım görseli: yalnızca hisse kodları ve yüzdeler" />
      <div className="flex flex-wrap justify-center gap-2">
        {canShare && <button type="button" onClick={share} disabled={sharing} className="flex items-center gap-2 rounded-lg bg-teal-300 px-4 py-2.5 text-sm font-semibold text-[#07171d] disabled:opacity-50"><Share2 size={16} />Paylaş</button>}
        {asset ? <a href={asset.url} download="portfoy-dagilimim.png" className="flex items-center gap-2 rounded-lg border border-teal-300/30 bg-[#0c2931] px-4 py-2.5 text-sm font-medium text-teal-200"><Download size={16} />PNG indir</a> : !error && <span role="status" className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={16} className="animate-spin" />Görsel hazırlanıyor…</span>}
      </div>
      {error && <div role="alert" className="text-center text-xs text-amber-300">{error} {!asset && <button type="button" className="ml-1 underline" onClick={() => setAttempt((n) => n + 1)}>Tekrar dene</button>}</div>}
      <p className="text-center text-[11px] text-slate-400">Görselde yalnızca hisse kodları ve yüzdeler yer alır.</p>
    </div>
  );
}

export default function StockAllocationPanel({ allocation }) {
  const [view, setView] = useState('allocation');
  const touchStart = useRef(null);
  // A stable projection also avoids rebuilding PNGs when only monetary values change.
  const projectionKey = JSON.stringify(getShareAllocation(allocation));
  const shareAllocation = useMemo(() => JSON.parse(projectionKey), [projectionKey]);
  return (
    <section
      aria-label="Hisseye göre dağılım"
      className="rounded-xl border border-navy-700/60 bg-navy-900 p-5"
      style={{ touchAction: 'pan-y' }}
      onTouchStart={(event) => {
        const touch = event.touches.length === 1 ? event.touches[0] : null;
        touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
      }}
      onTouchCancel={() => { touchStart.current = null; }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        touchStart.current = null;
        const end = event.changedTouches[0];
        if (!start || !end) return;
        const dx = end.clientX - start.x;
        const dy = end.clientY - start.y;
        if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          if (dx > 0 && shareAllocation.length) setView('share');
          else if (dx < 0) setView('allocation');
        }
      }}
    >
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink"><BarChart3 size={16} className="text-accent-soft" />Hisseye Göre Dağılım</h3>
      <div role="tablist" aria-label="Dağılım görünümü" className="mb-5 flex gap-1 rounded-lg bg-navy-800 p-1">
        <button type="button" role="tab" aria-selected={view === 'allocation'} onClick={() => setView('allocation')} className={`flex-1 rounded-md px-2 py-2 text-xs font-medium ${view === 'allocation' ? 'bg-navy-700 text-ink' : 'text-slate-400'}`}>Dağılım</button>
        <button type="button" role="tab" aria-selected={view === 'share'} onClick={() => setView('share')} disabled={!shareAllocation.length} className={`flex flex-1 items-center justify-center gap-2 rounded-md px-2 py-2 text-xs font-medium disabled:opacity-40 ${view === 'share' ? 'bg-[#0c2931] text-teal-200' : 'text-slate-400'}`}><Share2 size={14} />Paylaşım görseli</button>
      </div>
      {view === 'share' && shareAllocation.length > 0 ? <SharePreview allocation={shareAllocation} /> : <>
        <ul className="space-y-3">
          {allocation.map((item, i) => <li key={`${item.name}-${i}`}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs"><span className="font-medium text-slate-300">{item.name}</span><span className="tabular-nums text-slate-400">{formatCurrency(item.value)} · <span className="font-semibold text-ink">{item.percent.toFixed(1)}%</span></span></div>
            <div className="h-2 overflow-hidden rounded-full bg-navy-700/70"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, item.percent))}%`, backgroundColor: SHARE_COLORS[i % SHARE_COLORS.length] }} /></div>
          </li>)}
        </ul>
        <button type="button" onClick={() => setView('share')} disabled={!shareAllocation.length} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-teal-300/20 bg-[#0c2931] px-3 py-3 text-xs text-teal-200 disabled:opacity-40">Görsel için sağa kaydırın <ArrowRight size={15} /></button>
      </>}
    </section>
  );
}

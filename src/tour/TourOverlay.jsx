import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { findTourTarget, getTourHighlight, getTourPanelPosition, getTourViewport, scrollTourTarget } from './tourGeometry.js';
import './tour.css';

export default function TourOverlay({ step, index, total, target, status, onNext, onBack, onClose, onRetry }) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [geometry, setGeometry] = useState(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const root = document.getElementById('root');
    const wasInert = root?.hasAttribute('inert');
    root?.setAttribute('inert', '');
    document.documentElement.classList.add('tour-active');
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const buttons = [...panelRef.current.querySelectorAll('button:not(:disabled)')];
      const first = buttons[0];
      const last = buttons.at(-1);
      if (event.shiftKey && (document.activeElement === first || !buttons.includes(document.activeElement))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !buttons.includes(document.activeElement))) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      if (!wasInert) root?.removeAttribute('inert');
      document.documentElement.classList.remove('tour-active');
      document.documentElement.style.removeProperty('--tour-panel-space');
      const focusTarget = previousFocus?.isConnected ? previousFocus : document.querySelector('[data-tour="help-button"]');
      focusTarget?.focus?.({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    panelRef.current.focus({ preventScroll: true });
    panelRef.current.querySelector('.tour-content').scrollTop = 0;
  }, [index]);

  useLayoutEffect(() => {
    let frame;
    const update = (shouldScroll = false) => {
      const viewport = getTourViewport();
      const panel = panelRef.current;
      const compact = viewport.width < 640;
      panel.style.width = `${compact ? viewport.width - 24 : Math.min(420, viewport.width - 24)}px`;
      panel.style.maxHeight = `${Math.min(viewport.height - 24, compact ? Math.max(240, viewport.height * 0.48) : 520)}px`;
      const panelBounds = panel.getBoundingClientRect();
      document.documentElement.style.setProperty('--tour-panel-space', compact ? `${panelBounds.height + 32}px` : '0px');
      const scope = step.global ? document : document.querySelector(`[data-tour-page="${step.route}"]`);
      const currentTarget = target ? findTourTarget(scope, step.target) : null;
      if (shouldScroll && currentTarget && !step.centered) scrollTourTarget(currentTarget, viewport, panelBounds.height);
      const highlight = !step.centered && currentTarget
        ? getTourHighlight(currentTarget, viewport, compact ? viewport.top + viewport.height - panelBounds.height - 24 : Infinity)
        : null;
      const position = getTourPanelPosition(viewport, panelBounds, highlight, step.centered);
      setGeometry({ ...position, highlight });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => update());
    };
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => update(true));
    };
    update(true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(panelRef.current);
    if (target) observer?.observe(target);
    const mutations = new MutationObserver(schedule);
    const page = document.querySelector(`[data-tour-page="${step.route}"]`);
    if (page) mutations.observe(page, { childList: true, subtree: true });
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      mutations.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [target, step, status]);

  const highlight = geometry?.highlight;
  return createPortal(
    <div className="tour-layer">
      <div className={`tour-shade ${highlight ? '' : 'tour-shade-full'}`} aria-hidden="true" />
      {highlight && (
        <div data-testid="tour-highlight" className="tour-highlight" aria-hidden="true"
          style={{ left: highlight.left, top: highlight.top, width: highlight.width, height: highlight.height }} />
      )}
      <section
        ref={panelRef}
        className="tour-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-description"
        tabIndex={-1}
        style={{ left: geometry?.left ?? 12, top: geometry?.top ?? 12 }}
      >
        <div className="tour-heading">
          <div>
            <p className="tour-progress">Site tanıtımı · {index + 1} / {total}</p>
            <h2 id="tour-title">{step.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="tour-close" aria-label="Tanıtımı kapat"><X size={20} /></button>
        </div>
        <div className="tour-content" aria-live="polite">
          <p id="tour-description">{step.content}</p>
          {status === 'waiting' && <p className="tour-notice" role="status"><Loader2 size={16} className="animate-spin" />İlgili bölüm hazırlanıyor…</p>}
          {status === 'missing' && <p className="tour-notice" role="status">Bu bölüm şu anda görüntülenemiyor. Yeniden deneyebilir veya bu adımı atlayabilirsin.</p>}
        </div>
        <div className="tour-controls">
          <button type="button" className="tour-secondary" onClick={onClose}>Turu bitir</button>
          <div className="tour-navigation">
            {index > 0 && <button type="button" className="tour-secondary" onClick={onBack}>Geri</button>}
            {status === 'missing' && <button type="button" className="tour-secondary" onClick={onRetry}>Tekrar dene</button>}
            <button type="button" className="tour-primary" disabled={status === 'waiting'} onClick={onNext}>
              {index === total - 1 ? 'Tamamla' : status === 'missing' ? 'Adımı atla' : 'Devam'}
            </button>
          </div>
        </div>
      </section>
    </div>, document.body,
  );
}

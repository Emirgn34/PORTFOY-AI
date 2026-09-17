import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TOUR_STEPS } from './tourSteps.js';
import TourOverlay from './TourOverlay.jsx';
import { findTourTarget } from './tourGeometry.js';
import { useAuth } from '../contexts/AuthContext.jsx';

const TourContext = createContext(null);
const TARGET_TIMEOUT = 12000;

export function TourProvider({ children, onSidebarChange }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, isAdmin, isAuthenticated } = useAuth();
  const steps = useMemo(() => TOUR_STEPS.filter((step) =>
    (!step.adminOnly || isAdmin) && (!step.authOnly || isAuthenticated)), [isAdmin, isAuthenticated]);
  const [index, setIndex] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [prepared, setPrepared] = useState(null);
  const autoTimer = useRef(null);
  const started = useRef(false);
  const active = index !== null;
  const step = active ? steps[index] : null;
  const completionKey = `portfoyai_tour_done_v1_${user?.id || 'guest'}`;

  const finish = useCallback(() => {
    clearTimeout(autoTimer.current);
    setIndex(null);
    setPrepared(null);
    onSidebarChange?.(false);
    try { localStorage.setItem(completionKey, '1'); } catch { /* Depolama isteğe bağlı. */ }
  }, [completionKey, onSidebarChange]);

  const startTour = useCallback(() => {
    clearTimeout(autoTimer.current);
    started.current = true;
    setPrepared(null);
    setAttempt((value) => value + 1);
    setIndex(0);
  }, []);

  const goToStep = useCallback((nextIndex) => {
    if (nextIndex >= steps.length) return finish();
    setPrepared(null);
    setIndex(Math.max(0, nextIndex));
  }, [steps.length, finish]);

  // Sayfa değiştikten SONRA hedefi ara. Önceki adımın bekleyicisi cleanup ile iptal olur.
  useEffect(() => {
    if (!step) return undefined;
    setPrepared(null);
    onSidebarChange?.(step.action === 'openSidebar');
    if (pathname !== step.route) {
      navigate(step.route);
      return undefined;
    }

    const startedAt = Date.now();
    let previousTarget = null;
    let previousBounds = '';
    let timer;
    const check = () => {
      const scope = step.global
        ? document
        : document.querySelector(`[data-tour-page="${step.route}"]`);
      const target = findTourTarget(scope, step.target);
      const modalClosed = step.action?.startsWith('openModal') ||
        !document.querySelector('[data-tour="stock-modal"]');
      const rect = target?.getBoundingClientRect();
      const bounds = rect ? [rect.x, rect.y, rect.width, rect.height].join(',') : '';
      if (target && modalClosed && target === previousTarget && bounds === previousBounds) {
        setPrepared({ index, attempt, target, status: 'ready' });
        return;
      }
      if (Date.now() - startedAt >= TARGET_TIMEOUT) {
        setPrepared({ index, attempt, target: null, status: 'missing' });
        return;
      }
      previousTarget = target;
      previousBounds = bounds;
      timer = setTimeout(check, 80);
    };
    check();
    return () => clearTimeout(timer);
  }, [step, index, attempt, pathname, navigate, onSidebarChange]);

  useEffect(() => {
    if (started.current) return undefined;
    try {
      if (localStorage.getItem(completionKey) === '1') return undefined;
    } catch { /* Depolama kapalıysa da tanıtım çalışır. */ }
    autoTimer.current = setTimeout(startTour, 800);
    return () => clearTimeout(autoTimer.current);
  }, [completionKey, startTour]);

  const action = pathname === step?.route ? step.action ?? null : null;
  const value = useMemo(() => ({ startTour, isRunning: active, action }), [startTour, active, action]);
  const current = prepared?.index === index && prepared?.attempt === attempt && pathname === step?.route
    ? prepared : null;

  return (
    <TourContext.Provider value={value}>
      {children}
      {step && (
        <TourOverlay
          step={step}
          index={index}
          total={steps.length}
          target={current?.target ?? null}
          status={current?.status ?? 'waiting'}
          onNext={() => goToStep(index + 1)}
          onBack={() => goToStep(index - 1)}
          onClose={finish}
          onRetry={() => { setPrepared(null); setAttempt((value) => value + 1); }}
        />
      )}
    </TourContext.Provider>
  );
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour, TourProvider içinde kullanılmalı');
  return ctx;
}

export function useTourAction() {
  return useContext(TourContext)?.action ?? null;
}

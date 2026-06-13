/**
 * Site eğitimi orkestratörü.
 *
 * react-joyride'ı KONTROLLÜ modda kullanır: adımlar arası geçerken turu
 * duraklatır, gerekiyorsa sayfayı değiştirir (router), "Hisse Ekle" formunu
 * açar/kapatır (CustomEvent 'tour:action') ve hedef öğe DOM'da belirene kadar
 * bekler — böylece sayfa/aşağı kayma/otomatik ekran açma sorunsuz olur.
 *
 * Kullanıcı ilk girişte tur otomatik başlar (kişi başına bir kez, localStorage).
 * Sağ üstteki ampul ikonu useTour().startTour ile turu yeniden başlatır.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Joyride, { ACTIONS, EVENTS, STATUS } from 'react-joyride';
import { TOUR_STEPS } from './tourSteps.js';
import { useAuth } from '../contexts/AuthContext.jsx';

const TourContext = createContext(null);

/** Hedef öğe DOM'da belirene kadar bekler (yoksa zaman aşımıyla yine de devam). */
function waitForTarget(selector, timeout = 3000) {
  return new Promise((resolve) => {
    if (!selector || selector === 'body') return resolve();
    const start = Date.now();
    const tick = () => {
      if (document.querySelector(selector)) return resolve();
      if (Date.now() - start > timeout) return resolve();
      setTimeout(tick, 80);
    };
    tick();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** "Hisse Ekle" formunu açma/kapatma sinyali (PortfolioPage dinler). */
function dispatchAction(action) {
  window.dispatchEvent(new CustomEvent('tour:action', { detail: action || 'closeModal' }));
}

export function TourProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin } = useAuth();

  const steps = useMemo(
    () => TOUR_STEPS.filter((s) => !s.adminOnly || isAdmin),
    [isAdmin]
  );

  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // Geçişlerde güncel route'u okumak için ref (memoize'lu fonksiyonlarda taze kalsın)
  const locRef = useRef(location.pathname);
  locRef.current = location.pathname;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const finish = useCallback(() => {
    setRun(false);
    setStepIndex(0);
    dispatchAction('closeModal');
  }, []);

  const goToStep = useCallback(
    async (index) => {
      const list = stepsRef.current;
      if (index < 0) index = 0;
      if (index >= list.length) {
        finish();
        return;
      }
      const step = list[index];
      setRun(false); // hedef hazırlanırken turu duraklat

      const routeChanged = locRef.current !== step.route;
      if (routeChanged) navigate(step.route);
      dispatchAction(step.action);

      if (routeChanged) await sleep(150); // yeni sayfanın boyanması için
      await waitForTarget(step.target);
      await sleep(80); // form/modal animasyonu otursun

      setStepIndex(index);
      setRun(true);
    },
    [navigate, finish]
  );

  const startTour = useCallback(() => {
    goToStep(0);
  }, [goToStep]);

  const handleCallback = useCallback(
    (data) => {
      const { action, index, status, type } = data;
      if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
        finish();
        return;
      }
      if (action === ACTIONS.CLOSE) {
        finish();
        return;
      }
      if (type === EVENTS.STEP_AFTER) {
        goToStep(index + (action === ACTIONS.PREV ? -1 : 1));
      } else if (type === EVENTS.TARGET_NOT_FOUND) {
        goToStep(index + 1); // hedef bulunamazsa atla
      }
    },
    [finish, goToStep]
  );

  // İlk girişte otomatik başlat (kişi başına bir kez)
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    const key = `portfoyai_tour_done_v1_${user?.id || 'guest'}`;
    let done = false;
    try {
      done = localStorage.getItem(key) === '1';
    } catch {
      /* erişilemezse turu yine de göster */
    }
    if (done) return;
    autoStartedRef.current = true;
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* yok say */
    }
    // Sayfaların mount olması için kısa gecikme
    setTimeout(() => startTour(), 800);
  }, [user?.id, startTour]);

  const value = useMemo(() => ({ startTour, isRunning: run }), [startTour, run]);

  return (
    <TourContext.Provider value={value}>
      <Joyride
        steps={steps}
        run={run}
        stepIndex={stepIndex}
        continuous
        showProgress
        showSkipButton
        disableOverlayClose
        spotlightClicks={false}
        scrollToFirstStep
        callback={handleCallback}
        locale={{
          back: 'Geri',
          close: 'Kapat',
          last: 'Bitir',
          next: 'Anladım',
          nextLabelWithProgress: 'Anladım ({step}/{steps})',
          skip: 'Geç',
        }}
        styles={{
          options: {
            zIndex: 10000,
            primaryColor: '#6366f1',
            backgroundColor: '#0f1b3d',
            arrowColor: '#0f1b3d',
            textColor: '#e2e8f0',
            overlayColor: 'rgba(2, 6, 23, 0.72)',
          },
          tooltipTitle: { fontSize: 16, fontWeight: 700 },
          tooltipContent: { fontSize: 13.5, lineHeight: 1.6, padding: '12px 4px' },
          buttonNext: { borderRadius: 8, fontSize: 13, fontWeight: 600 },
          buttonBack: { color: '#94a3b8', fontSize: 13 },
          buttonSkip: { color: '#64748b', fontSize: 13 },
        }}
      />
      {children}
    </TourContext.Provider>
  );
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour, TourProvider içinde kullanılmalı');
  return ctx;
}

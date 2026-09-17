import { lazy, StrictMode, useEffect, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from '../components/Layout.jsx';
import { useTourAction } from './TourProvider.jsx';

vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'test' }, isAdmin: false, isAuthenticated: true, configured: false }),
}));
vi.mock('./tourSteps.js', () => ({ TOUR_STEPS: [
  { route: '/portfolio', target: '[data-tour="summary"]', title: 'Özet', content: 'Özet açıklaması', centered: true },
  { route: '/portfolio', target: '[data-tour="search"]', title: 'Arama', content: 'Arama açıklaması', action: 'openModal' },
  { route: '/portfolio', target: '[data-tour="advanced"]', title: 'Kademe', content: 'Kademe açıklaması', action: 'openModalAdvanced' },
  { route: '/watchlist', target: '[data-tour="list"]', title: 'Takip', content: 'Takip açıklaması' },
  { route: '/news', target: '[data-tour="missing"]', title: 'Eksik hedef', content: 'Eksik açıklaması' },
] }));

function Portfolio({ delay = 0 }) {
  const [ready, setReady] = useState(delay === 0);
  const action = useTourAction();
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  if (!ready) return <p>Veriler yükleniyor</p>;
  return <>
    <div data-tour="summary">Portföy içeriği</div>
    {action?.startsWith('openModal') && <div data-tour="stock-modal">
      <input data-tour="search" aria-label="Hisse ara" />
      {action === 'openModalAdvanced' && <div data-tour="advanced">Gelişmiş form</div>}
    </div>}
  </>;
}

function LocationLabel() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function setup({ route = '/analysis', delay = 0, strict = false, watchlist = <div data-tour="list">Takip içeriği</div> } = {}) {
  const tree = <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <LocationLabel />
    <Routes><Route element={<Layout />}>
      <Route path="/portfolio" element={<Portfolio delay={delay} />} />
      <Route path="/analysis" element={<div data-tour="summary">Başka sayfadaki aynı hedef</div>} />
      <Route path="/watchlist" element={watchlist} />
      <Route path="/news" element={<div>Hedef bulunmuyor</div>} />
    </Route></Routes>
  </MemoryRouter>;
  const container = document.createElement('div');
  container.id = 'root';
  document.body.append(container);
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree, { container });
}

async function tick(ms = 200) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
async function start() {
  fireEvent.click(screen.getByRole('button', { name: 'Site tanıtım turunu başlat' }));
  await tick();
}
async function next() {
  fireEvent.click(screen.getByRole('button', { name: 'Devam' }));
  await tick();
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.setItem('portfoyai_tour_done_v1_test', '1');
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const width = this.classList.contains('tour-panel') ? parseFloat(this.style.width) || 420 : 180;
    const height = this.classList.contains('tour-panel') ? Math.min(220, parseFloat(this.style.maxHeight) || 520) : 40;
    return { x: 300, y: 100, left: 300, top: 100, right: 300 + width, bottom: 100 + height, width, height };
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('tanıtım geçişleri', () => {
  it('başka sayfadan başlatıldığında doğru sayfaya gider ve geç gelen içeriği bekler', async () => {
    setup({ delay: 1600 });
    await start();
    expect(screen.getByTestId('location')).toHaveTextContent('/portfolio');
    expect(screen.queryByText('Başka sayfadaki aynı hedef')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Devam' })).toBeDisabled();
    await tick(1700);
    await tick(); // React yüklenen içeriği commit ettikten sonra hedef kararlılığı kontrol edilir.
    expect(screen.getByRole('button', { name: 'Devam' })).toBeEnabled();
    await next();
    expect(screen.getByRole('dialog', { name: 'Arama' })).toBeInTheDocument();
    expect(screen.getByLabelText('Hisse ara')).toBeInTheDocument();
  });

  it('formu ve gelişmiş bölümü açar; ileri ve geri sayfa geçişlerinde hedefi yeniden hazırlar', async () => {
    setup();
    await start();
    await next();
    await next();
    expect(screen.getByText('Gelişmiş form')).toBeInTheDocument();
    await next();
    expect(screen.getByTestId('location')).toHaveTextContent('/watchlist');
    expect(screen.queryByLabelText('Hisse ara')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Geri' }));
    await tick();
    expect(screen.getByTestId('location')).toHaveTextContent('/portfolio');
    expect(screen.getByText('Gelişmiş form')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Geri' }));
    await tick();
    expect(screen.queryByText('Gelişmiş form')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Hisse ara')).toBeInTheDocument();
  });

  it('yükleme sırasında kapatılan tur gecikmeli işlemlerle yeniden açılmaz', async () => {
    setup({ delay: 2200 });
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Tanıtımı kapat' }));
    await tick(15000);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass('tour-active');
  });

  it('lazy sayfa yüklenirken başlık ve tur açık kalır, yeni hedef yüklenince devam eder', async () => {
    let resolveModule;
    const LazyWatchlist = lazy(() => new Promise((resolve) => { resolveModule = resolve; }));
    setup({ watchlist: <LazyWatchlist /> });
    await start();
    await next();
    await next();
    await next();
    expect(screen.getByRole('dialog', { name: 'Takip' })).toBeVisible();
    expect(screen.getByText('Sayfa yükleniyor…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Devam' })).toBeDisabled();
    await act(async () => { resolveModule({ default: () => <div data-tour="list">Yüklenen takip listesi</div> }); });
    await tick();
    expect(screen.getByRole('button', { name: 'Devam' })).toBeEnabled();
    expect(screen.getByText('Yüklenen takip listesi')).toBeInTheDocument();
  });

  it('mobil ekran küçülünce kutuyu yeniden konumlandırır ve kontrolleri odak sırasına alır', async () => {
    vi.stubGlobal('innerWidth', 375);
    vi.stubGlobal('innerHeight', 667);
    setup();
    await start();
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.width).toBe('351px');
    expect(document.getElementById('root')).toHaveAttribute('inert');
    vi.stubGlobal('innerHeight', 320);
    fireEvent(window, new Event('resize'));
    await tick();
    expect(parseFloat(dialog.style.top) + dialog.getBoundingClientRect().height).toBeLessThanOrEqual(308);
    screen.getByRole('button', { name: 'Tanıtımı kapat' }).focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Devam' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.getElementById('root')).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'Site tanıtım turunu başlat' })).toHaveFocus();
  });

  it('bulunmayan hedefe boş spotlight çizmez; tekrar deneme ve atlama sunar', async () => {
    setup();
    await start();
    await next();
    await next();
    await next();
    await next();
    await tick(12200);
    expect(screen.queryByTestId('tour-highlight')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(screen.getByRole('button', { name: 'Tamamla' })).toBeDisabled();
    await tick(12200);
    fireEvent.click(screen.getByRole('button', { name: 'Tamamla' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('StrictMode otomatik tur zamanlayıcısını iki kez başlatmaz ve Escape ile kapatılır', async () => {
    localStorage.clear();
    setup({ strict: true });
    await tick(900);
    await tick();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    await tick(1200);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('portfoyai_tour_done_v1_test')).toBe('1');
  });
});

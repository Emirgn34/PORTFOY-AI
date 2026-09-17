import { describe, expect, it } from 'vitest';
import { findTourTarget, getTourHighlight, getTourPanelPosition } from './tourGeometry.js';
import { TOUR_STEPS } from './tourSteps.js';

describe('tanıtım ekran sınırları', () => {
  it.each([
    [320, 568, 230], [375, 667, 250], [390, 844, 280], [568, 320, 240], [1280, 720, 300],
  ])('%sx%s ekranda bütün açıklama kutusunu görünür tutar', (width, height, panelHeight) => {
    const viewport = { left: 0, top: 0, width, height };
    const panel = { width: Math.min(420, width - 24), height: panelHeight };
    const target = { left: width - 30, right: width - 10, top: height - 35, bottom: height - 10 };
    const result = getTourPanelPosition(viewport, panel, target);
    expect(result.left).toBeGreaterThanOrEqual(12);
    expect(result.top).toBeGreaterThanOrEqual(12);
    expect(result.left + panel.width).toBeLessThanOrEqual(width - 12);
    expect(result.top + panel.height).toBeLessThanOrEqual(height - 12);
  });

  it('klavye/zoom ile küçülen ve kayan görünür alanı hesaba katar', () => {
    const viewport = { left: 20, top: 100, width: 320, height: 350 };
    const panel = { width: 296, height: 240 };
    const position = getTourPanelPosition(viewport, panel, null);
    expect(position).toEqual({ left: 32, top: 198 });
  });

  it('gizli ve ekran dışındaki menü hedeflerini kullanmaz', () => {
    const scope = document.createElement('div');
    scope.innerHTML = '<button data-tour="same" style="display:none">Gizli</button><button data-tour="same">Görünür</button>';
    document.body.append(scope);
    for (const button of scope.children) button.getBoundingClientRect = () => ({ left: 10, right: 110, width: 100, height: 40 });
    expect(findTourTarget(scope, '[data-tour="same"]')).toBe(scope.children[1]);
    scope.children[1].getBoundingClientRect = () => ({ left: -256, right: 0, width: 256, height: 40 });
    expect(findTourTarget(scope, '[data-tour="same"]')).toBeNull();
    scope.remove();
  });

  it('uzun formdaki spotlight alanını kaydırma kabına ve mobil kutunun üstüne kırpar', () => {
    const parent = document.createElement('div');
    parent.style.overflowY = 'auto';
    const target = document.createElement('div');
    parent.append(target);
    document.body.append(parent);
    parent.getBoundingClientRect = () => ({ left: 16, right: 359, top: 16, bottom: 350 });
    target.getBoundingClientRect = () => ({ left: 30, right: 345, top: 250, bottom: 550, width: 315, height: 300 });
    const highlight = getTourHighlight(target, { left: 0, top: 0, width: 375, height: 667 }, 330);
    expect(highlight.bottom).toBe(330);
    expect(highlight.height).toBe(84);
    parent.remove();
  });

  it('güncel bölümleri ve tema ayarını içerir; yönetimi role göre sınırlar', () => {
    expect(TOUR_STEPS.map((step) => step.route)).toEqual(expect.arrayContaining(['/model-portfolios', '/research', '/account']));
    expect(TOUR_STEPS.find((step) => step.target.includes('theme-toggle')).action).toBe('openSidebar');
    expect(TOUR_STEPS.find((step) => step.route === '/admin').adminOnly).toBe(true);
  });
});

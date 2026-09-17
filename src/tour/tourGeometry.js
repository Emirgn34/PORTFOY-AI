export function getTourViewport() {
  const viewport = window.visualViewport;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
}

export function findTourTarget(scope, selector) {
  if (!scope) return null;
  return [...scope.querySelectorAll(selector)].find((element) => {
    const rect = element.getBoundingClientRect();
    if (!element.isConnected || rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.left >= window.innerWidth) return false;
    for (let parent = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    return true;
  }) ?? null;
}

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

export function getTourPanelPosition(viewport, panel, target, centered = false) {
  const gap = 12;
  const left = viewport.left + gap;
  const top = viewport.top + gap;
  const right = viewport.left + viewport.width - gap;
  const bottom = viewport.top + viewport.height - gap;
  if (viewport.width < 640) return { left, top: Math.max(top, bottom - panel.height) };
  if (target && !centered) {
    const candidates = [
      { left: target.right + gap, top: target.top },
      { left: target.left - panel.width - gap, top: target.top },
      { left: target.left, top: target.bottom + gap },
      { left: target.left, top: target.top - panel.height - gap },
    ];
    for (const position of candidates) {
      if (position.left >= left && position.left + panel.width <= right &&
          position.top >= top && position.top + panel.height <= bottom) return position;
    }
  }
  return {
    left: clamp(viewport.left + (viewport.width - panel.width) / 2, left, right - panel.width),
    top: clamp(viewport.top + (viewport.height - panel.height) / 2, top, bottom - panel.height),
  };
}

// Spotlight yalnızca hedefin görünen kısmını kaplar; taşan tablo/form alanlarını değil.
export function getTourHighlight(element, viewport, bottomLimit = Infinity) {
  if (!element?.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  let left = Math.max(viewport.left + 4, rect.left - 4);
  let top = Math.max(viewport.top + 4, rect.top - 4);
  let right = Math.min(viewport.left + viewport.width - 4, rect.right + 4);
  let bottom = Math.min(viewport.top + viewport.height - 4, rect.bottom + 4, bottomLimit);
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      left = Math.max(left, bounds.left);
      right = Math.min(right, bounds.right);
    }
  }
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top, right, bottom } : null;
}

export function scrollTourTarget(element, viewport, panelHeight) {
  element.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'instant' });
  if (viewport.width >= 640) return;
  const availableBottom = viewport.top + viewport.height - panelHeight - 32;
  const availableTop = viewport.top + 76;
  const adjustment = () => {
    const rect = element.getBoundingClientRect();
    const visibleHeight = Math.min(rect.height, Math.max(0, availableBottom - availableTop));
    return rect.top + visibleHeight / 2 - (availableTop + availableBottom) / 2;
  };
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) {
      parent.scrollTop += adjustment();
    }
  }
  window.scrollBy({ top: adjustment(), behavior: 'instant' });
}

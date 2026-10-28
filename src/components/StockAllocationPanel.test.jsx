import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StockAllocationPanel from './StockAllocationPanel.jsx';

const mocks = vi.hoisted(() => ({ png: vi.fn() }));
vi.mock('../utils/portfolioShare.js', async (importOriginal) => ({ ...await importOriginal(), createPortfolioSharePng: mocks.png }));
const allocation = [{ name: 'AAPL', percent: 60, value: 987654321 }, { name: 'MSFT', percent: 40, value: 123456789 }];

beforeEach(() => {
  mocks.png.mockReset().mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:share-png'), revokeObjectURL: vi.fn() });
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn(() => false) });
  Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn().mockResolvedValue() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('StockAllocationPanel', () => {
  it('opens export on a right swipe and passes only symbols/percentages to PNG creation', async () => {
    render(<StockAllocationPanel allocation={allocation} />);
    const panel = screen.getByRole('region', { name: 'Hisseye göre dağılım' });
    fireEvent.touchStart(panel, { touches: [{ clientX: 20, clientY: 100 }] });
    fireEvent.touchEnd(panel, { changedTouches: [{ clientX: 130, clientY: 110 }] });
    expect(await screen.findByRole('link', { name: 'PNG indir' })).toHaveAttribute('download', 'portfoy-dagilimim.png');
    expect(mocks.png).toHaveBeenCalledWith([{ label: 'AAPL', percent: 60 }, { label: 'MSFT', percent: 40 }]);
    expect(screen.getByRole('img').getAttribute('src')).not.toMatch(/987654321|123456789/);
    fireEvent.touchStart(panel, { touches: [{ clientX: 150, clientY: 100 }] });
    fireEvent.touchEnd(panel, { changedTouches: [{ clientX: 30, clientY: 100 }] });
    expect(screen.getByRole('tab', { name: 'Dağılım' })).toHaveAttribute('aria-selected', 'true');
  });

  it('allows vertical scrolling without opening a share and supports button navigation', async () => {
    render(<StockAllocationPanel allocation={allocation} />);
    const panel = screen.getByRole('region');
    fireEvent.touchStart(panel, { touches: [{ clientX: 20, clientY: 100 }] });
    fireEvent.touchEnd(panel, { changedTouches: [{ clientX: 90, clientY: 300 }] });
    expect(mocks.png).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Paylaşım görseli' }));
    await screen.findByRole('link', { name: 'PNG indir' });
    expect(screen.queryByRole('button', { name: 'Paylaş' })).not.toBeInTheDocument();
  });

  it('shares a prepared PNG from the click, handles cancellation and cleans object URLs', async () => {
    navigator.canShare.mockReturnValue(true);
    navigator.share.mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    const { unmount } = render(<StockAllocationPanel allocation={allocation} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Paylaşım görseli' }));
    const button = await screen.findByRole('button', { name: 'Paylaş' });
    expect(navigator.share).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(navigator.share).toHaveBeenCalledTimes(1));
    expect(navigator.share.mock.calls[0][0].files[0]).toMatchObject({ name: 'portfoy-dagilimim.png', type: 'image/png' });
    await act(async () => {});
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:share-png');
  });

  it('shows an actionable export failure and retries', async () => {
    mocks.png.mockRejectedValueOnce(new Error('canvas unavailable'));
    render(<StockAllocationPanel allocation={allocation} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Paylaşım görseli' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Görsel hazırlanamadı');
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    await screen.findByRole('link', { name: 'PNG indir' });
  });
});

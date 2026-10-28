import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PortfolioTable from './PortfolioTable.jsx';
import { movePortfolioStock } from '../utils/portfolioOrder.js';

const stocks = ['AAPL', 'MSFT', 'NVDA'].map((ticker) => ({ id: ticker, ticker, market: 'US', company: ticker, quantity: 3, avgPrice: 100, currentPrice: 120, currency: 'USD' }));
function Harness() {
  const [items, setItems] = useState(stocks);
  return <PortfolioTable stocks={items} onReorder={(a, b) => setItems((prev) => movePortfolioStock(prev, a, b))} onEdit={vi.fn()} onDelete={vi.fn()} sortConfig={{ key: null }} onSort={vi.fn()} period="day" />;
}

describe('PortfolioTable personal order', () => {
  it('moves holdings with keyboard arrows and retains edit/delete actions', () => {
    render(<Harness />);
    const handle = screen.getByRole('button', { name: 'AAPL sırasını değiştir' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    let rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByRole('button', { name: 'MSFT sırasını değiştir' })).toBeInTheDocument();
    expect(within(rows[1]).getByRole('button', { name: 'AAPL sırasını değiştir' })).toBeInTheDocument();
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByTitle('Düzenle')).toBeInTheDocument();
    expect(within(rows[0]).getByTitle('Sil')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('button', { name: 'AAPL sırasını değiştir' })).toBeInTheDocument();
  });

  it('disables personal drag while a column is being sorted', () => {
    const reorder = vi.fn();
    render(<PortfolioTable stocks={stocks} sortConfig={{ key: 'ticker', direction: 'asc' }} onSort={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onReorder={reorder} period="day" />);
    expect(screen.getByRole('button', { name: 'AAPL sırasını değiştir' })).toBeDisabled();
    expect(reorder).not.toHaveBeenCalled();
  });

  it('requires a long press on touch and cancels activation if the finger scrolls first', async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<Harness />);
      const handle = screen.getByRole('button', { name: 'AAPL sırasını değiştir' });
      const touch = { identifier: 1, target: handle, clientX: 20, clientY: 100 };
      fireEvent.touchStart(handle, { touches: [touch], changedTouches: [touch] });
      await act(async () => { vi.advanceTimersByTime(250); });
      expect(handle).not.toHaveAttribute('aria-pressed', 'true');
      fireEvent.touchMove(handle, { touches: [{ ...touch, clientY: 130 }], changedTouches: [{ ...touch, clientY: 130 }] });
      await act(async () => { vi.advanceTimersByTime(100); });
      expect(handle).not.toHaveAttribute('aria-pressed', 'true');
      fireEvent.touchEnd(handle, { touches: [], changedTouches: [touch] });
      fireEvent.touchStart(handle, { touches: [touch], changedTouches: [touch] });
      await act(async () => { vi.advanceTimersByTime(310); });
      expect(handle).toHaveAttribute('aria-pressed', 'true');
      fireEvent.touchCancel(handle, { touches: [], changedTouches: [touch] });
      await act(async () => { vi.advanceTimersByTime(100); });
      expect(within(screen.getAllByRole('row')[1]).getByRole('button', { name: 'AAPL sırasını değiştir' })).toBeInTheDocument();
      unmount();
    } finally { vi.useRealTimers(); }
  });
});

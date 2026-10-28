import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PortfolioPage from './PortfolioPage.jsx';

const state = vi.hoisted(() => ({ sync: {}, stocks: [] }));
vi.mock('../hooks/useSyncedState.js', () => ({ default: () => { const [items, setItems] = useState(state.stocks); return [items, setItems, state.sync]; } }));
vi.mock('../hooks/useLivePrices.js', () => ({ default: () => ({ isOffline: true }) }));
vi.mock('../tour/TourProvider.jsx', () => ({ useTourAction: () => null }));
vi.mock('../components/PortfolioSummaryCards.jsx', () => ({ default: () => null }));
vi.mock('../components/HedgeShieldDashboard.tsx', () => ({ default: () => null }));
vi.mock('../components/StockFormModal.jsx', () => ({ default: () => null }));
vi.mock('../components/StockAllocationPanel.jsx', () => ({ default: () => null }));
vi.mock('recharts', () => ({ PieChart: () => null, Pie: () => null, Cell: () => null, ResponsiveContainer: () => null, Tooltip: () => null }));

beforeEach(() => {
  state.stocks = ['MSFT', 'AAPL', 'NVDA'].map((ticker) => ({ id: ticker, ticker, market: 'US', company: ticker, quantity: 10, avgPrice: 100, currentPrice: 120, currency: 'USD' }));
  state.sync = { loading: false, cloud: true, saveStatus: 'idle', flush: vi.fn(), retrySave: vi.fn(), reload: vi.fn() };
});

const rowSymbols = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getByRole('button', { name: /sırasını değiştir/ }).getAttribute('aria-label').split(' ')[0]);
describe('PortfolioPage order and save feedback', () => {
  it('persists a manual move immediately and restores that order after temporary column sorting', () => {
    render(<PortfolioPage />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'NVDA sırasını değiştir' }), { key: 'ArrowUp' });
    expect(rowSymbols()).toEqual(['MSFT', 'NVDA', 'AAPL']);
    expect(state.sync.flush).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /^Hisse$/ }));
    expect(screen.getByRole('button', { name: 'NVDA sırasını değiştir' })).toBeDisabled();
    expect(rowSymbols()).toEqual(['NVDA', 'MSFT', 'AAPL']);
    fireEvent.click(screen.getByRole('button', { name: 'Kişisel sıra' }));
    expect(rowSymbols()).toEqual(['MSFT', 'NVDA', 'AAPL']);
  });

  it('shows load failures instead of an editable empty portfolio', () => {
    state.sync.loadError = new Error('offline');
    render(<PortfolioPage />);
    expect(screen.queryByRole('button', { name: 'Hisse Ekle' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(state.sync.reload).toHaveBeenCalledOnce();
  });

  it('offers retry when a changed order could not be saved', () => {
    state.sync.saveStatus = 'error';
    render(<PortfolioPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Değişiklikler kaydedilemedi');
    fireEvent.click(screen.getByRole('button', { name: 'Kaydı tekrar dene' }));
    expect(state.sync.retrySave).toHaveBeenCalledOnce();
  });
});

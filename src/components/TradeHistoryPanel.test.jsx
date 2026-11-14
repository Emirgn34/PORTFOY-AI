import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import TradeHistoryPanel from './TradeHistoryPanel.jsx';
import { tradeRequest } from '../services/trade.js';

vi.mock('../services/trade.js', () => ({ tradeRequest: vi.fn() }));

function history(items = []) {
  return { items, summary: { total: items.length, pending: 0, active: 0, completed: items.length,
    resolved: items.length, settledCount: items.length, targetCount: items.length, stopCount: 0, winRate: items.length ? 100 : null,
    stopRate: items.length ? 0 : null, averageNetReturnPct: items.length ? 2.8 : null },
  pagination: { page: 1, pageSize: 20, total: items.length, hasMore: false }, tracking: {} };
}
function plan() {
  return { id: 'aapl-plan', symbol: 'AAPL', name: 'Apple', currency: 'USD', mode: 'research',
    strategyId: 'intraday', strategyName: 'Gün içi trade', direction: 'long', status: 'target',
    createdAt: '2026-11-14T14:30:00Z', enteredAt: '2026-11-14T14:32:00Z', closedAt: '2026-11-14T15:00:00Z',
    lastCheckedAt: '2026-11-14T15:00:00Z', trackingEndsAt: '2026-11-14T21:00:00Z',
    entry: 100, entryLow: 100, entryHigh: 100, stopLoss: 98, netReturnPct: 2.8, costBps: 20,
    executionModel: 'Sabit referansa temasla varsayımsal giriş; giriş için en fazla 30 dakika.',
    entryDeadlineAt: '2026-11-14T15:00:00Z',
    targets: [{ id: 'near', label: 'İlk hedef', targetPrice: 103, status: 'target', hitAt: '2026-11-14T15:00:00Z', netReturnPct: 2.8 }],
    events: [{ type: 'entry', at: '2026-11-14T14:32:00Z', message: 'Model girişi oluştu.', price: 100 },
      { type: 'target', at: '2026-11-14T15:00:00Z', message: 'İlk hedef doğrulandı.', price: 103 }] };
}
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

test('arşivlenmiş planı, model sonucunu ve sabit seviyelerle zaman çizelgesini gösterir', async () => {
  tradeRequest.mockResolvedValue(history([plan()]));
  render(<TradeHistoryPanel />);
  expect(await screen.findByText('AAPL')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Trade performans özeti' })).getByText('%100')).toBeInTheDocument();
  expect(screen.getByText(/her plan, başarı hesabında ilk hedefiyle bir kez sayılır/i)).toBeInTheDocument();
  const details = screen.getByRole('button', { name: 'Planı incele · AAPL' });
  fireEvent.click(details);
  expect(details).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('Model girişi oluştu. · 100 USD')).toBeInTheDocument();
  expect(screen.getByText('İlk hedef doğrulandı. · 103 USD')).toBeInTheDocument();
  expect(screen.getByText('İlk zarar kes').nextElementSibling).toHaveTextContent('98 USD');
  expect(screen.getByText(/Sabit referansa temasla varsayımsal giriş/)).toBeInTheDocument();
  expect(screen.getByText('Giriş bekleme sonu').nextElementSibling).not.toHaveTextContent('—');
});

test('filtre değişimi sunucuya gider ve geciken eski filtre yanıtı yeni listeyi ezmez', async () => {
  let oldResolve;
  tradeRequest.mockImplementationOnce(() => new Promise((resolve) => { oldResolve = resolve; }))
    .mockResolvedValue(history([]));
  render(<TradeHistoryPanel />);
  const firstSignal = tradeRequest.mock.calls[0][1].signal;
  fireEvent.change(screen.getByLabelText('Geçmiş veri türü'), { target: { value: 'live' } });
  await screen.findByText('Bu filtrelerde kayıtlı trade yok');
  expect(firstSignal.aborted).toBe(true);
  expect(tradeRequest).toHaveBeenLastCalledWith('history', expect.objectContaining({ query: expect.objectContaining({ mode: 'live', page: 1 }) }));
  await act(async () => { oldResolve(history([plan()])); });
  expect(screen.queryByText('AAPL')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Geçmiş hisse sembolü'), { target: { value: 'msft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Hisse geçmişini filtrele' }));
  await waitFor(() => expect(tradeRequest).toHaveBeenLastCalledWith('history', expect.objectContaining({ query: expect.objectContaining({ symbol: 'MSFT' }) })));
});

test('eksik kurulumda sıfır başarı istatistiği üretmez; kurulum durumunu gösterir', async () => {
  tradeRequest.mockResolvedValue({ ...history(), installationRequired: true });
  render(<TradeHistoryPanel />);
  expect(await screen.findByText('Geçmiş takibi kurulum bekliyor')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Trade performans özeti' })).not.toBeInTheDocument();
});

test('yenileme hatasında kayıtları korur ve yeniden denemeyle hatayı temizler', async () => {
  tradeRequest.mockResolvedValueOnce(history([plan()])).mockRejectedValueOnce(new Error('Bağlantı kesildi.')).mockResolvedValue(history([plan()]));
  render(<TradeHistoryPanel />);
  await screen.findByText('AAPL');
  fireEvent.click(screen.getByRole('button', { name: 'Geçmişi yenile' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Son alınan kayıtlar gösteriliyor');
  expect(screen.getByText('AAPL')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Geçmişi yenile' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

test('yavaş istekler üst üste binmez ve ayrılırken iptal edilir', async () => {
  vi.useFakeTimers();
  tradeRequest.mockImplementation(() => new Promise(() => {}));
  const { unmount } = render(<TradeHistoryPanel />);
  await act(async () => { await vi.advanceTimersByTimeAsync(65000); });
  expect(tradeRequest).toHaveBeenCalledTimes(1);
  const signal = tradeRequest.mock.calls[0][1].signal;
  unmount();
  expect(signal.aborted).toBe(true);
});

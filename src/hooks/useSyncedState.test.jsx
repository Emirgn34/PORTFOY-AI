import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useSyncedState from './useSyncedState.js';

const state = vi.hoisted(() => ({
  auth: { configured: true, isAuthenticated: true, user: { id: 'alice' } },
  read: vi.fn(), write: vi.fn(),
}));
vi.mock('../contexts/AuthContext.jsx', () => ({ useAuth: () => state.auth }));
vi.mock('../services/supabaseClient.js', () => ({ supabase: {
  from: () => ({ select: () => ({ eq: (_key, id) => ({ maybeSingle: () => state.read(id) }) }), upsert: (data) => state.write(data) }),
} }));
const options = { table: 'portfolios', column: 'stocks', localKey: 'test-portfolio', seed: [{ id: 'demo' }] };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

beforeEach(() => {
  state.auth = { configured: true, isAuthenticated: true, user: { id: 'alice' } };
  state.read.mockReset().mockResolvedValue({ data: { stocks: [{ id: 'a' }, { id: 'b' }] }, error: null });
  state.write.mockReset().mockResolvedValue({ error: null });
  localStorage.clear();
});

describe('useSyncedState persistence', () => {
  it('never writes an empty seed after a failed cloud read and supports reload', async () => {
    state.read.mockResolvedValueOnce({ data: null, error: new Error('offline') });
    const { result } = renderHook(() => useSyncedState(options));
    await waitFor(() => expect(result.current[2].loadError).toBeTruthy());
    act(() => result.current[1]([]));
    await act(async () => { await result.current[2].flush(); });
    expect(state.write).not.toHaveBeenCalled();
    act(() => result.current[2].reload());
    await waitFor(() => expect(result.current[0][0]?.id).toBe('a'));
    expect(result.current[2].loadError).toBeNull();
  });

  it('flushes a reorder immediately, serializes in-flight writes and retries the latest data', async () => {
    const first = deferred();
    state.write.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ error: new Error('offline') }).mockResolvedValue({ error: null });
    const { result } = renderHook(() => useSyncedState(options));
    await waitFor(() => expect(result.current[2].loading).toBe(false));
    act(() => { result.current[1]([{ id: 'b' }, { id: 'a' }]); void result.current[2].flush(); });
    await waitFor(() => expect(state.write).toHaveBeenCalledTimes(1));
    act(() => { result.current[1]([{ id: 'b', currentPrice: 700 }, { id: 'a' }]); void result.current[2].flush(); });
    expect(state.write).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve({ error: null }); await result.current[2].flush(); });
    expect(state.write).toHaveBeenCalledTimes(2);
    expect(result.current[2].saveStatus).toBe('error');
    await act(async () => { await result.current[2].retrySave(); });
    expect(state.write.mock.calls[2][0].stocks[0]).toEqual({ id: 'b', currentPrice: 700 });
    expect(result.current[2].saveStatus).toBe('saved');
  });

  it('keeps an account ID bound to its edit when the signed-in account changes', async () => {
    const { result, rerender } = renderHook(() => useSyncedState(options));
    await waitFor(() => expect(result.current[2].loading).toBe(false));
    act(() => result.current[1]([{ id: 'alice-edit' }]));
    state.auth = { ...state.auth, user: { id: 'bob' } };
    state.read.mockResolvedValue({ data: { stocks: [{ id: 'bob-stock' }] }, error: null });
    rerender();
    await waitFor(() => expect(result.current[0]).toEqual([{ id: 'bob-stock' }]));
    expect(state.write.mock.calls[0][0]).toMatchObject({ user_id: 'alice', stocks: [{ id: 'alice-edit' }] });
    act(() => result.current[1]([{ id: 'bob-edit' }]));
    await act(async () => { await result.current[2].flush(); });
    expect(state.write.mock.calls[1][0]).toMatchObject({ user_id: 'bob', stocks: [{ id: 'bob-edit' }] });
  });

  it('retains a pending edit across unmount and reloads persisted personal order', async () => {
    let stored = [{ id: 'a' }, { id: 'b' }];
    state.read.mockImplementation(async () => ({ data: { stocks: stored }, error: null }));
    state.write.mockImplementation(async (data) => { stored = data.stocks; return { error: null }; });
    const first = renderHook(() => useSyncedState(options));
    await waitFor(() => expect(first.result.current[2].loading).toBe(false));
    act(() => first.result.current[1]([{ id: 'b' }, { id: 'a' }]));
    first.unmount();
    await waitFor(() => expect(stored[0].id).toBe('b'));
    const second = renderHook(() => useSyncedState(options));
    await waitFor(() => expect(second.result.current[2].loading).toBe(false));
    expect(second.result.current[0]).toEqual([{ id: 'b' }, { id: 'a' }]);
  });

  it('loads and stores personal order locally without an account', async () => {
    state.auth = { configured: false, isAuthenticated: false, user: null };
    localStorage.setItem('test-portfolio', JSON.stringify([{ id: 'b' }, { id: 'a' }]));
    const { result } = renderHook(() => useSyncedState(options));
    await waitFor(() => expect(result.current[2].loading).toBe(false));
    expect(result.current[0][0].id).toBe('b');
    act(() => result.current[1]((prev) => [...prev].reverse()));
    expect(JSON.parse(localStorage.getItem('test-portfolio'))[0].id).toBe('a');
    expect(state.write).not.toHaveBeenCalled();
  });

  it('waits for an in-flight save when a page is immediately reopened', async () => {
    const saving = deferred();
    let stored = [{ id: 'a' }, { id: 'b' }];
    state.read.mockImplementation(async () => ({ data: { stocks: stored }, error: null }));
    state.write.mockImplementation(async (data) => { await saving.promise; stored = data.stocks; return { error: null }; });
    const first = renderHook(() => useSyncedState(options));
    await waitFor(() => expect(first.result.current[2].loading).toBe(false));
    act(() => first.result.current[1]([{ id: 'b' }, { id: 'a' }]));
    first.unmount();
    const second = renderHook(() => useSyncedState(options));
    expect(second.result.current[2].loading).toBe(true);
    expect(state.read).toHaveBeenCalledTimes(1);
    await act(async () => { saving.resolve(); });
    await waitFor(() => expect(second.result.current[2].loading).toBe(false));
    expect(second.result.current[0]).toEqual([{ id: 'b' }, { id: 'a' }]);
  });
});

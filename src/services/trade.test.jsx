import { vi } from 'vitest';
import { tradeRequest } from './trade.js';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('./supabaseClient.js', () => ({ supabase: { auth: { getSession } } }));

beforeEach(() => {
  vi.useFakeTimers();
  getSession.mockReset();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test('oturum yenilemesi takılsa bile bütün trade isteği 12 saniyede sonlanır', async () => {
  getSession.mockReturnValue(new Promise(() => {}));
  const result = expect(tradeRequest()).rejects.toThrow('zaman aşımına uğradı');
  await vi.advanceTimersByTimeAsync(12000);
  await result;
  expect(fetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test('oturum beklenirken çağıran iptal edebilir; geç çözülen oturum ağ isteği başlatmaz', async () => {
  let resolveSession;
  getSession.mockReturnValue(new Promise((resolve) => { resolveSession = resolve; }));
  const controller = new AbortController();
  const request = tradeRequest('state', { signal: controller.signal });
  const result = expect(request).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await result;
  resolveSession({ data: { session: { access_token: 'example-session' } } });
  await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test('önceden iptal edilmiş istek oturum beklemeye başlamaz', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(tradeRequest('state', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(getSession).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test('yanıt gövdesi takıldığında da süre sınırı korunur ve fetch sinyali iptal edilir', async () => {
  getSession.mockResolvedValue({ data: { session: { access_token: 'example-session' } } });
  fetch.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
  const result = expect(tradeRequest()).rejects.toThrow('zaman aşımına uğradı');
  await vi.advanceTimersByTimeAsync(12000);
  await result;
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test('başarılı tercih isteği yetki ve gövdeyi taşır; zamanlayıcı ve iptal dinleyicisi temizlenir', async () => {
  getSession.mockResolvedValue({ data: { session: { access_token: 'example-session' } } });
  fetch.mockResolvedValue({ ok: true, json: async () => ({ preferences: { enabled: true } }) });
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  await expect(tradeRequest('preferences', { method: 'POST', body: { enabled: true }, signal: controller.signal }))
    .resolves.toEqual({ preferences: { enabled: true } });
  expect(fetch).toHaveBeenCalledWith('/api/account?feature=trade&action=preferences', expect.objectContaining({
    method: 'POST', headers: { Authorization: 'Bearer example-session', 'Content-Type': 'application/json' },
    body: '{"enabled":true}', cache: 'no-store',
  }));
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});

test('geçmiş filtreleri ayrı parametreler olarak kodlanır; action ve oturum değiştirilemez', async () => {
  getSession.mockResolvedValue({ data: { session: { access_token: 'example-session' } } });
  fetch.mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
  await tradeRequest('history', { query: { page: 2, symbol: 'AAPL&action=ingest', period: '30', action: 'ingest', token: 'bad' } });
  const url = new URL(fetch.mock.calls[0][0], 'https://example.test');
  expect(url.searchParams.get('action')).toBe('history');
  expect(url.searchParams.get('symbol')).toBe('AAPL&action=ingest');
  expect(url.searchParams.get('page')).toBe('2');
  expect(url.searchParams.has('token')).toBe(false);
});

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), single: vi.fn(), listManagedUsers: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: { getUser: mocks.getUser },
  from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }),
}) }));
vi.mock('../../server/adminUsers.js', () => ({ listManagedUsers: mocks.listManagedUsers }));

vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-server-key');
const { default: handler } = await import('../../api/admin/users.js');
afterAll(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'caller' } }, error: null });
  mocks.single.mockResolvedValue({ data: { role: 'user' } });
  mocks.listManagedUsers.mockResolvedValue([{ id: 'one', username: 'ali', last_sign_in_at: null }]);
});

function response() {
  return { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

describe('son giriş API yetkisi', () => {
  it('oturumsuz istekleri reddeder ve giriş bilgilerini sorgulamaz', async () => {
    const res = response();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mocks.listManagedUsers).not.toHaveBeenCalled();
  });

  it('normal kullanıcılara diğer kullanıcıların girişlerini döndürmez', async () => {
    const res = response();
    await handler({ method: 'GET', headers: { authorization: 'Bearer token' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mocks.listManagedUsers).not.toHaveBeenCalled();
  });

  it('yöneticiye bilgileri önbelleksiz döndürür', async () => {
    mocks.single.mockResolvedValue({ data: { role: 'admin' } });
    const res = response();
    await handler({ method: 'GET', headers: { authorization: 'Bearer token' } }, res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ users: [{ id: 'one', username: 'ali', last_sign_in_at: null }] });
  });
});

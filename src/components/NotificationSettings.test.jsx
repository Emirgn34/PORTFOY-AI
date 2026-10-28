import { render,screen,waitFor,fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import NotificationSettings from './NotificationSettings.jsx';
import { automationRequest } from '../services/automation.js';
vi.mock('../services/automation.js',() => ({automationRequest:vi.fn()}));
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
test('izin kendiliğinden istenmez; düğme tıklamasıyla abonelik sunucuya kaydedilir',async () => {
  const subscription={endpoint:'https://web.push.apple.com/test',toJSON:() => ({endpoint:'https://web.push.apple.com/test',keys:{}})};
  const registration={pushManager:{getSubscription:vi.fn().mockResolvedValue(null),subscribe:vi.fn().mockResolvedValue(subscription)}};
  vi.stubGlobal('isSecureContext',true); vi.stubGlobal('PushManager',function(){});
  const permission=vi.fn().mockResolvedValue('granted'); vi.stubGlobal('Notification',{requestPermission:permission});
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:vi.fn().mockResolvedValue(registration),ready:Promise.resolve(registration)}});
  automationRequest.mockResolvedValue({configured:true,publicKey:'YQ',subscriptions:[]});
  render(<NotificationSettings />);
  const button=screen.getByRole('button',{name:'Bildirimleri etkinleştir'});
  await waitFor(() => expect(button).toBeEnabled());
  expect(permission).not.toHaveBeenCalled(); fireEvent.click(button);
  expect(permission).toHaveBeenCalledOnce();
  await waitFor(() => expect(automationRequest).toHaveBeenCalledWith('push',{method:'POST',body:{subscription:subscription.toJSON(),topics:['catalyst','source-portfolios']}}));
  expect(await screen.findByRole('status')).toHaveTextContent('kaydedildi');
  expect(screen.queryByRole('button',{name:'Test bildirimi gönder'})).not.toBeInTheDocument();
  delete navigator.serviceWorker;
});

function setupSubscription({ permission = 'granted', expired = false, key = new Uint8Array([97]).buffer, stored = true } = {}) {
  const old = { endpoint: 'https://web.push.apple.com/old', expirationTime: expired ? Date.now() - 1000 : null,
    options: { applicationServerKey: key }, unsubscribe: vi.fn().mockResolvedValue(true),
    toJSON: () => ({ endpoint: 'https://web.push.apple.com/old', keys: {} }) };
  const fresh = { endpoint: 'https://web.push.apple.com/fresh', unsubscribe: vi.fn().mockResolvedValue(true),
    toJSON: () => ({ endpoint: 'https://web.push.apple.com/fresh', keys: {} }) };
  const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(old), subscribe: vi.fn().mockResolvedValue(fresh) } };
  vi.stubGlobal('isSecureContext', true); vi.stubGlobal('PushManager', function () {});
  vi.stubGlobal('Notification', { permission, requestPermission: vi.fn().mockResolvedValue(permission) });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
    register: vi.fn().mockResolvedValue(registration), ready: Promise.resolve(registration),
  } });
  automationRequest.mockResolvedValue({ configured: true, publicKey: 'YQ',
    subscriptions: stored ? [{ endpoint: old.endpoint, topics: ['catalyst'] }] : [] });
  return { old, fresh, registration };
}

test.each([{ expired: true }, { key: new Uint8Array([98]).buffer }])('süresi dolmuş veya anahtarı değişmiş abonelik düğmeyle yenilenir: %j', async (options) => {
  const { old, fresh, registration } = setupSubscription(options);
  render(<NotificationSettings />);
  expect(await screen.findByRole('status')).toHaveTextContent('bağlantısı yenilenmeli');
  expect(old.unsubscribe).not.toHaveBeenCalled();
  expect(Notification.requestPermission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Bildirimleri etkinleştir' }));
  await waitFor(() => expect(old.unsubscribe).toHaveBeenCalledOnce());
  await waitFor(() => expect(registration.pushManager.subscribe).toHaveBeenCalledOnce());
  await waitFor(() => expect(automationRequest).toHaveBeenCalledWith('push', { method: 'POST',
    body: { subscription: fresh.toJSON(), topics: ['catalyst'] } }));
});

test('tarayıcıda kapatılmış izin kayıtlı abonelik olsa da etkin gösterilmez', async () => {
  setupSubscription({ permission: 'denied' });
  render(<NotificationSettings />);
  expect(await screen.findByRole('status')).toHaveTextContent('izni tarayıcıda kapalı');
  expect(screen.getByText('Bu cihazda bildirim izni kapalı')).toBeInTheDocument();
  expect(screen.queryByText('Bu cihazın bildirim aboneliği kayıtlı')).not.toBeInTheDocument();
});

test('yenilenmiş abonelik sunucuya kaydedilemezse cihaz etkin gösterilmez ve yeni abonelik geri alınır', async () => {
  const { fresh } = setupSubscription({ expired: true });
  render(<NotificationSettings />);
  await screen.findByRole('status');
  automationRequest.mockRejectedValueOnce(new Error('Sunucuya kaydedilemedi'));
  fireEvent.click(screen.getByRole('button', { name: 'Bildirimleri etkinleştir' }));
  await waitFor(() => expect(fresh.unsubscribe).toHaveBeenCalledOnce());
  expect(screen.getByRole('status')).toHaveTextContent('Sunucuya kaydedilemedi');
  expect(screen.getByText('Bu cihazda bildirim bağlantısı etkin değil')).toBeInTheDocument();
});

test('sunucuda eksik abonelik kullanıcıya gösterilir ve mevcut cihaz aboneliği yeniden kaydedilir', async () => {
  const { old, registration } = setupSubscription({ stored: false });
  render(<NotificationSettings />);
  expect(await screen.findByRole('status')).toHaveTextContent('sunucuda bulunamadı');
  fireEvent.click(screen.getByRole('button', { name: 'Bildirimleri etkinleştir' }));
  await waitFor(() => expect(automationRequest).toHaveBeenCalledWith('push', { method: 'POST',
    body: { subscription: old.toJSON(), topics: ['catalyst', 'source-portfolios'] } }));
  expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
});

test('desteklenmeyen tarayıcıda bildirim API’sine erişilmez', async () => {
  vi.stubGlobal('Notification', undefined);
  automationRequest.mockResolvedValue({ configured: true, publicKey: 'YQ', subscriptions: [] });
  render(<NotificationSettings />);
  expect(screen.getByText(/Bu tarayıcıda telefon bildirimi kullanılamıyor/)).toBeInTheDocument();
  await waitFor(() => expect(automationRequest).toHaveBeenCalled());
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

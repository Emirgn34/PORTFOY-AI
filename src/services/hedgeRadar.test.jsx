import {test,expect,vi,afterEach} from 'vitest';
import {enableShieldNotifications,hedgeRequest} from './hedgeRadar';
import {supabase} from './supabaseClient.js';
vi.mock('./supabaseClient.js',()=>({supabase:{auth:{getSession:vi.fn()}}}));
afterEach(()=>{vi.unstubAllGlobals();delete navigator.serviceWorker;vi.clearAllMocks();});

test('kalkan aboneliği izin isteğini tıklama anında yapar ve mevcut bildirim konularını korur',async()=>{
  supabase.auth.getSession.mockResolvedValue({data:{session:{access_token:'signed-owner-token'}}});
  const subscription={endpoint:'https://web.push.apple.com/test',toJSON:()=>({endpoint:'https://web.push.apple.com/test',keys:{}})};
  const registration={pushManager:{getSubscription:vi.fn().mockResolvedValue(subscription)}};
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:vi.fn().mockResolvedValue(registration),ready:Promise.resolve(registration)}});
  const requestPermission=vi.fn().mockResolvedValue('granted');
  vi.stubGlobal('Notification',{requestPermission});
  const fetcher=vi.fn().mockResolvedValue(Response.json({ok:true}));vi.stubGlobal('fetch',fetcher);
  const operation=enableShieldNotifications({publicKey:'YQ',subscriptions:[{endpoint:subscription.endpoint,topics:['catalyst','source-portfolios']}]});
  expect(requestPermission).toHaveBeenCalledOnce();
  await operation;
  const [path,init]=fetcher.mock.calls[0];
  expect(path).toBe('/api/notifications/subscribe');
  expect(init.headers.Authorization).toBe('Bearer signed-owner-token');
  expect(JSON.parse(init.body).topics).toEqual(['catalyst','source-portfolios','hedge-radar']);
});

test('sunucu aboneliği reddederse yeni cihaz aboneliğini geri alır',async()=>{
  supabase.auth.getSession.mockResolvedValue({data:{session:{access_token:'token'}}});
  const subscription={endpoint:'https://web.push.apple.com/test',toJSON:()=>({}),unsubscribe:vi.fn().mockResolvedValue(true)};
  const registration={pushManager:{getSubscription:vi.fn().mockResolvedValue(null),subscribe:vi.fn().mockResolvedValue(subscription)}};
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:vi.fn().mockResolvedValue(registration),ready:Promise.resolve(registration)}});
  vi.stubGlobal('Notification',{requestPermission:vi.fn().mockResolvedValue('granted')});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({error:'Kayıt reddedildi'},{status:403})));
  await expect(enableShieldNotifications({publicKey:'YQ',subscriptions:[]})).rejects.toThrow('Kayıt reddedildi');
  expect(subscription.unsubscribe).toHaveBeenCalledOnce();
});

test('oturum yoksa radar isteği göndermez',async()=>{
  supabase.auth.getSession.mockResolvedValue({data:{session:null}});
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  await expect(hedgeRequest()).rejects.toThrow('hesabınıza giriş');
  expect(fetcher).not.toHaveBeenCalled();
});

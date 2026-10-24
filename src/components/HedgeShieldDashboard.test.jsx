import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {vi} from 'vitest';
import HedgeShieldDashboard from './HedgeShieldDashboard.tsx';
import {hedgeRequest} from '../services/hedgeRadar';

vi.mock('../services/hedgeRadar',()=>({hedgeRequest:vi.fn(),enableShieldNotifications:vi.fn()}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
const state={market_regime:'HEDGE_TRIGGER',previous_regime:'TRAP_WARNING',updated_at:new Date().toISOString(),
  qqq_price:97,qqq_sma50:100,qqq_atr:4,qqq_weekly_ema20:99,qqq_weekly_ema50:80,
  soxx_price:95,soxx_sma50:100,soxx_weekly_ema20:100,soxx_weekly_ema50:85,
  vix_level:23,vix_change_pct:10,portfolio_beta:1.55,portfolio_value_usd:10000,
  recommended_action:'Kırılım onaylandı. Koruma senaryosunu incele.',refresh_status:'completed',
  hedge_recipe:{hedge_ratio:.5,stop_level:100,soxx_beta:1.2,spy_beta:1.7,note:'Her satır ayrı senaryodur.'},
  diagnostics:{market_open:false,as_of:new Date().toISOString(),confirmation_tr:'22:45',close_window_tr:'22:30–23:00',
    volume_ratio:1.2,time_confirmed:true,atr_confirmed:true,volume_confirmed:true,price_source:'Yahoo Finance'},
  stock_radar:[{ticker:'RKLB',price:20,weight_pct:100,sma50:21,sma50_distance_pct:-4.76,
    weekly_ema20_distance_pct:2,monthly_ema100_distance_pct:null,status:'BELOW_SUPPORT',note:'100 aylık geçmiş yok.'}]};
function mockState(value=state) {hedgeRequest.mockImplementation(async(path='',method='GET')=>
  path==='/api/notifications/subscribe'?{configured:false,subscriptions:[]}:method==='POST'?{message:'Analiz sıraya alındı.'}:{state:value});}

test('rejim ve destekleri gösterir; beta/kaldıraç reçetesini %50 ve %100 için doğru hesaplar',async()=>{
  mockState();render(<HedgeShieldDashboard/>);
  expect(await screen.findByText('Hedge alarmı')).toBeInTheDocument();
  expect(screen.getByText('%25,83')).toBeInTheDocument();
  expect(screen.getByText('%77,50')).toBeInTheDocument();
  expect(Number(screen.getByRole('meter',{name:'QQQ günlük SMA50'}).getAttribute('aria-valuenow'))).toBeCloseTo(-3);
  expect(screen.getByText('100 aylık geçmiş yok.')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox',{name:'Koruma oranı'}),{target:{value:'1'}});
  expect(screen.getByText('%51,67')).toBeInTheDocument();
  expect(screen.getByText('%155,00')).toBeInTheDocument();
  expect(screen.getAllByText('Portföy tutarından fazla nakit gerektirir.')).toHaveLength(2);
});

test('manuel düğme analiz işini sıraya alır; veri gelmeden yeni rejim uydurmaz',async()=>{
  mockState();render(<HedgeShieldDashboard/>);
  await screen.findByText('Hedge alarmı');
  fireEvent.click(screen.getByRole('button',{name:'Şimdi Analiz Et'}));
  await waitFor(()=>expect(hedgeRequest).toHaveBeenCalledWith('/refresh','POST'));
  expect(await screen.findByRole('status')).toHaveTextContent('Analiz sıraya alındı');
  expect(screen.getByText('Hedge alarmı')).toBeInTheDocument();
});

test('eksik kurulum ve boş veri gerçek hata ile görünür; demo sinyal üretilmez',async()=>{
  hedgeRequest.mockRejectedValue(new Error('Kalkan hesabı henüz yapılandırılmadı.'));
  render(<HedgeShieldDashboard/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('henüz yapılandırılmadı');
  expect(screen.queryByText('Güvenli trend')).not.toBeInTheDocument();
});

test('bayat veri ve varsayılan portföyü açıkça ayırt eder',async()=>{
  mockState({...state,diagnostics:{...state.diagnostics,market_open:true,as_of:'2020-01-01T00:00:00Z',fallback_portfolio:true}});
  render(<HedgeShieldDashboard/>);
  expect(await screen.findByText('Veri gecikti · yeni sinyal bekleniyor')).toBeInTheDocument();
  expect(screen.getByText(/Bu beta kişisel portföy betası değildir/)).toBeInTheDocument();
});

test('tamamlanmayan iş analizi yeniden başlatma düğmesini sonsuza kadar kilitlemez',async()=>{
  mockState({...state,refresh_status:'queued',refresh_requested_at:'2020-01-01T00:00:00Z'});
  render(<HedgeShieldDashboard/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('15 dakikadır tamamlanmadı');
  expect(screen.getByRole('button',{name:'Şimdi Analiz Et'})).toBeEnabled();
});

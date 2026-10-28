import {render,screen} from '@testing-library/react';
import {vi} from 'vitest';
import CatalystNewsPanel from './CatalystNewsPanel.jsx';
import {automationRequest} from '../services/automation.js';
vi.mock('../services/automation.js',()=>({automationRequest:vi.fn()}));
vi.mock('./NotificationSettings.jsx',()=>({default:()=>null}));

test('hızlı haberde Türkçe başlık ve açılabilir özgün başlık gösterilir',async()=>{
  automationRequest.mockResolvedValue({status:null,events:[{id:'event',body:'Vicor gelir tahminini yükseltti',published_at:'2026-09-24T18:00:00Z',data:{label:'Gelir / kâr tahmini yükseldi',symbols:['VICR'],source:'Newswire',sourceUrl:'https://example.com/vicor',latencySeconds:2,originalTitle:'Vicor raises revenue guidance',titleTr:'Vicor gelir tahminini yükseltti',translationStatus:'translated'}}]});
  render(<CatalystNewsPanel/>);
  expect(await screen.findByRole('heading',{name:'Vicor gelir tahminini yükseltti'})).toBeInTheDocument();
  expect(screen.getByText('Otomatik çeviri · özgün başlığı göster')).toBeInTheDocument();
  expect(screen.getByText('Vicor raises revenue guidance')).toBeInTheDocument();
  expect(screen.getByRole('link',{name:/Kaynak haberi aç/})).toHaveAttribute('href','https://example.com/vicor');
});

test('yeni haber olmasa da başarılı kaynak kontrolü gecikmiş gösterilmez; süre ve kaynak sayısı görünür', async () => {
  const current = new Date().toISOString();
  automationRequest.mockResolvedValue({ events: [], status: { updated_at: current, data: {
    mode: 'rss', connected: true, intervalSeconds: 60, durationMs: 1200, lastSuccessfulCheckAt: current,
    feedChecks: [1, 2, 3, 4].map(() => ({ ok: true, latestPublishedAt: '2026-01-01T00:00:00Z' })),
  } } });
  render(<CatalystNewsPanel />);
  expect(await screen.findByText('Ücretsiz basın açıklamaları · aralıklı kontrol')).toBeInTheDocument();
  expect(screen.getByText(/Planlı kontrol aralığı: 60 sn/)).toHaveTextContent('4/4 kaynak yanıt verdi');
  expect(screen.queryByText(/Haber kontrolü gecikti/)).not.toBeInTheDocument();
});

test('bir kaynak arızalıyken diğer kaynakların izlendiği açıkça gösterilir', async () => {
  const current = new Date().toISOString();
  automationRequest.mockResolvedValue({ events: [], status: { updated_at: current, data: {
    mode: 'rss', connected: true, intervalSeconds: 60, lastSuccessfulCheckAt: current,
    feedChecks: [{ ok: true }, { ok: true }, { ok: true }, { ok: false }],
  } } });
  render(<CatalystNewsPanel />);
  expect(await screen.findByText('Bazı haber kaynaklarına ulaşılamadı · diğer kaynaklar izleniyor')).toBeInTheDocument();
  expect(screen.getByText(/3\/4 kaynak yanıt verdi/)).toBeInTheDocument();
});

test('başarısız yeni tur son başarı zamanını güncelmiş gibi göstermez', async () => {
  const current = new Date().toISOString();
  const old = new Date(Date.now() - 10 * 60000).toISOString();
  automationRequest.mockResolvedValue({ events: [], status: { updated_at: current, data: {
    mode: 'rss', connected: false, intervalSeconds: 60, lastSuccessfulCheckAt: old,
    feedChecks: [{ ok: false }, { ok: false }, { ok: false }, { ok: false }],
  } } });
  render(<CatalystNewsPanel />);
  expect(await screen.findByText('Ücretsiz haber kaynaklarına bağlantı kurulamadı')).toBeInTheDocument();
  expect(screen.getByText(/Son başarılı bağlantı:/)).toBeInTheDocument();
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import TradePage from './TradePage.jsx';
import { tradeRequest } from '../services/trade.js';

vi.mock('../services/trade.js', () => ({ tradeRequest: vi.fn() }));
vi.mock('../components/NotificationSettings.jsx', () => ({ default: ({ suggestedTopics }) => <p>Cihaz konuları: {suggestedTopics.join(',')}</p> }));

function candidate(overrides = {}) {
  return {
    id: 'AAPL-trade', symbol: 'AAPL', name: 'Apple', currency: 'USD', market: 'NASDAQ',
    status: 'ready', score: 81, entry: 100, stopLoss: 98,
    estimatedHours: [1, 3], reasons: ['Hacim desteğiyle VWAP üzerinde.', 'Piyasa eğilimi olumlu.'],
    blockers: [], warnings: ['Hedef gerçekleşmeyebilir.'],
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
    metrics: { roundTripCostBps: 20, spreadBps: 20, estimatedCostPerShare: 0.4 },
    dataQuality: { source: 'Licensed provider', realtime: true, sessionVerified: true, halted: false,
      quoteTime: new Date().toISOString(), barTime: new Date(Date.now() - 60000).toISOString() },
    scenarios: [
      { id: 'lower', risk: 'lower', targetPercent: 3, targetPrice: 103, stopLoss: 98, netRewardRisk: 1.3, estimatedHours: [1, 2], eligible: true },
      { id: 'medium', risk: 'medium', targetPercent: 5, targetPrice: 105, stopLoss: 98, netRewardRisk: 2.2, estimatedHours: [2, 3], eligible: true },
      { id: 'high', risk: 'high', targetPercent: 7, targetPrice: 107, stopLoss: 98, netRewardRisk: 3.1, estimatedHours: [3, 4], eligible: false },
    ], ...overrides,
  };
}
function state(items = [candidate()]) {
  return { items, preferences: { enabled: false }, serverTime: new Date().toISOString(), status: { running: false, message: 'Canlı akış kontrol ediliyor.' },
    requirements: [{ id: 'feed', label: 'Gerçek zamanlı fiyat', status: 'missing', detail: 'Lisanslı veri bağlantısı gerekli.' }] };
}
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

test('kart gerekçeyi ve süreyi gösterir; ayrıntı hedef, zarar kes ve risk hesabını açar', async () => {
  tradeRequest.mockResolvedValue(state());
  render(<TradePage />);
  const card = await screen.findByRole('button', { name: 'AAPL trade detayını aç' });
  expect(within(card).getByText('1–3 işlem saati')).toBeInTheDocument();
  expect(within(card).getByText('Hacim desteğiyle VWAP üzerinde.')).toBeInTheDocument();
  card.focus();
  fireEvent.click(card);
  const modal = screen.getByRole('dialog', { name: 'AAPL · Trade planı' });
  expect(within(modal).getByText('+%3 hedef')).toBeInTheDocument();
  expect(within(modal).getByText('+%5 hedef')).toBeInTheDocument();
  expect(within(modal).getByText('Görece temkinli')).toBeInTheDocument();
  expect(within(modal).getByText('Agresif')).toBeInTheDocument();
  expect(within(modal).getByText(/doğrulanmış süre tahmini değildir/)).toBeInTheDocument();
  expect(within(modal).getByText('1,3×')).toBeInTheDocument();
  fireEvent.change(within(modal).getByLabelText('İşleme ayrılabilir sermaye'), { target: { value: '10000' } });
  expect(within(modal).getByText(/20 adet · Yaklaşık zarar kes/)).toHaveTextContent('48 USD');
  fireEvent.change(within(modal).getByLabelText('Azami kayıp bütçesi yüzde'), { target: { value: '5' } });
  expect(within(modal).getByText(/99 adet · Yaklaşık zarar kes/)).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(card).toHaveFocus();
});

test('süresi dolmuş hazır sinyal sayılmaz ve modalda işlem koşulu geçersiz gösterilir', async () => {
  tradeRequest.mockResolvedValue(state([candidate({ expiresAt: new Date(Date.now() - 1000).toISOString() })]));
  render(<TradePage />);
  const card = await screen.findByRole('button', { name: 'AAPL trade detayını aç' });
  expect(within(card).getByText('Süresi doldu')).toBeInTheDocument();
  expect(screen.queryByText('Koşullar uygun')).not.toBeInTheDocument();
  fireEvent.click(card);
  const modal = screen.getByRole('dialog');
  expect(within(modal).getByRole('status')).toHaveTextContent('Sinyalin süresi doldu');
  expect(within(modal).queryByText('Veri ve risk koşulları uygun')).not.toBeInTheDocument();
});

test('trade uyarısı yalnızca açık tercih ile kaydedilir; cihaz konusu ayrıca gösterilir', async () => {
  tradeRequest.mockResolvedValue(state([]));
  render(<TradePage />);
  await screen.findByText('Şu an gösterilecek trade adayı yok');
  const checkbox = screen.getByRole('checkbox', { name: /Hesabım için trade uyarılarını aç/ });
  expect(checkbox).not.toBeChecked();
  expect(tradeRequest).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Cihaz konuları: trade')).toBeInTheDocument();
  tradeRequest.mockResolvedValueOnce({ preferences: { enabled: true } });
  fireEvent.click(checkbox);
  await waitFor(() => expect(tradeRequest).toHaveBeenCalledWith('preferences', { method: 'POST', body: { enabled: true } }));
  await waitFor(() => expect(checkbox).toBeChecked());
  expect(screen.getByRole('status')).toHaveTextContent('Bu telefonda da');
});

test('bağlantı hatasında hayalî kart ve hedef göstermez', async () => {
  tradeRequest.mockRejectedValue(new Error('Trade veri tabloları kurulmamış.'));
  render(<TradePage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Trade veri tabloları kurulmamış.');
  expect(screen.queryByRole('button', { name: /trade detayını aç/ })).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /Hesabım için trade/ })).toBeDisabled();
});

test('devam eden istekle polling çakışmaz; sayfadan çıkarken istek iptal edilir', async () => {
  vi.useFakeTimers();
  tradeRequest.mockImplementation(() => new Promise(() => {}));
  const { unmount } = render(<TradePage />);
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  expect(tradeRequest).toHaveBeenCalledTimes(1);
  const signal = tradeRequest.mock.calls[0][1].signal;
  unmount();
  expect(signal.aborted).toBe(true);
});

test('telefon saati geride olsa da sunucu zamanında eski fiyat hazır sinyal sayılmaz', async () => {
  const now = Date.now();
  const item = candidate();
  item.dataQuality.quoteTime = new Date(now - 20000).toISOString();
  const response = state([item]);
  response.serverTime = new Date(now).toISOString();
  vi.spyOn(Date, 'now').mockReturnValue(now - 3600000);
  tradeRequest.mockResolvedValue(response);
  render(<TradePage />);
  const card = await screen.findByRole('button', { name: 'AAPL trade detayını aç' });
  expect(within(card).getByText('Süresi doldu')).toBeInTheDocument();
  expect(screen.queryByText('Koşullar uygun')).not.toBeInTheDocument();
});

test('hissenin sinyal kimliği yenilenince açık detay korunur; güncel bağlam gösterilir', async () => {
  vi.useFakeTimers();
  const first = state();
  const next = state([candidate({ id: 'new-bar-id', name: 'Apple güncel', context: {
    news: [{ title: 'Yeni şirket açıklaması', url: 'https://example.com/filing', publisher: 'Şirket', publishedAt: new Date().toISOString() }],
    candidate: { score: 82, horizon: 'short' },
    intelligence: { fundamentals: { trailingPE: 22, forwardPE: 20, priceToBook: 3 }, earnings: { date: '2026-11-15' } },
    macroEvents: [{ title: 'Faiz kararı', time: new Date().toISOString() }],
  } })]);
  tradeRequest.mockResolvedValueOnce(first).mockResolvedValue(next);
  render(<TradePage />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  fireEvent.click(screen.getByRole('button', { name: 'AAPL trade detayını aç' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  const modal = screen.getByRole('dialog');
  expect(within(modal).getByText(/Apple güncel/)).toBeInTheDocument();
  expect(within(modal).getByRole('link', { name: 'Yeni şirket açıklaması' })).toHaveAttribute('href', 'https://example.com/filing');
  expect(within(modal).getByText('22 · 20 · 3')).toBeInTheDocument();
  expect(within(modal).getByText('2026-11-15 · Saat bilinmiyor')).toBeInTheDocument();
  expect(within(modal).getByText(/Faiz kararı/)).toBeInTheDocument();
});

test('bildirimden gelen sembol bağlantısı güncel hisse detayını açar', async () => {
  window.history.replaceState({}, '', '/trade?symbol=AAPL');
  tradeRequest.mockResolvedValue(state());
  render(<TradePage />);
  expect(await screen.findByRole('dialog', { name: 'AAPL · Trade planı' })).toBeInTheDocument();
  window.history.replaceState({}, '', '/');
});

test('telefon uykuya girip dönünce yeni veri gelene kadar önceki sinyal uygun görünmez', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get');
  visibility.mockReturnValue('visible');
  tradeRequest.mockResolvedValueOnce(state()).mockImplementation(() => new Promise(() => {}));
  render(<TradePage />);
  const card = await screen.findByRole('button', { name: 'AAPL trade detayını aç' });
  expect(within(card).getByText('Koşullar uygun')).toBeInTheDocument();
  visibility.mockReturnValue('hidden');
  fireEvent(document, new Event('visibilitychange'));
  expect(within(card).getByText('Süresi doldu')).toBeInTheDocument();
  visibility.mockReturnValue('visible');
  fireEvent(document, new Event('visibilitychange'));
  expect(within(card).getByText('Süresi doldu')).toBeInTheDocument();
  visibility.mockRestore();
});

test('yenileme bağlantısı kopunca süre henüz dolmasa da önceki hazır sinyal uygun görünmez',async()=>{
  vi.useFakeTimers();
  tradeRequest.mockResolvedValueOnce(state()).mockRejectedValue(new Error('Bağlantı koptu.'));
  render(<TradePage />);
  await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  const card=screen.getByRole('button',{name:'AAPL trade detayını aç'});
  expect(within(card).getByText('Koşullar uygun')).toBeInTheDocument();
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
  expect(screen.getByRole('alert')).toHaveTextContent('Bağlantı koptu.');
  expect(within(card).getByText('Süresi doldu')).toBeInTheDocument();
});

test('tercih kaydından önce başlayan eski polling yanıtı başarılı tercihi geri almaz', async () => {
  vi.useFakeTimers();
  let resolveOldPoll;
  tradeRequest.mockImplementation((action) => {
    if (action === 'preferences') return Promise.resolve({ preferences: { enabled: true } });
    if (!resolveOldPoll && tradeRequest.mock.calls.filter(([key]) => key === 'state').length === 1) return Promise.resolve(state([]));
    return new Promise((resolve) => { resolveOldPoll = resolve; });
  });
  render(<TradePage />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  const preference = screen.getByRole('checkbox', { name: /Hesabım için trade/ });
  fireEvent.click(preference);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(preference).toBeChecked();
  await act(async () => { resolveOldPoll(state([])); });
  expect(preference).toBeChecked();
  expect(screen.getByRole('status')).toHaveTextContent('açıldı');
});

test('canlı veri olmayan araştırma kartı eksik para birimi hatası gibi sunulmaz', async () => {
  tradeRequest.mockResolvedValue(state([candidate({ availability: 'research-only', status: 'blocked', entry: null,
    scenarios: [], estimatedHours: null, blockers: ['Bu hisse için doğrulanmış canlı trade verisi henüz alınmadı.'] })]));
  render(<TradePage />);
  const card = await screen.findByRole('button', { name: 'AAPL trade detayını aç' });
  expect(within(card).getByText('Fiyat verisi henüz alınamadı')).toBeInTheDocument();
  expect(within(card).getByText('Fiyat kaynağı kontrol ediliyor')).toBeInTheDocument();
  expect(within(card).getByText(/kapanmış dakikalık mumlar sırayla/)).toBeInTheDocument();
  fireEvent.click(card);
  const detail=within(screen.getByRole('dialog'));
  expect(detail.getByRole('status')).toHaveTextContent('araştırma adayıdır');
  expect(detail.getByText('Canlı plan oluşmadı')).toBeInTheDocument();
  expect(detail.getByText(/hisse başına toplam maliyet hesaplanamaz/)).toBeInTheDocument();
  expect(detail.queryByText(/toplam tahmini maliyet 0/)).not.toBeInTheDocument();
  expect(detail.getByLabelText('İşleme ayrılabilir sermaye')).toBeDisabled();
  expect(detail.getByLabelText('Azami kayıp bütçesi yüzde')).toBeDisabled();
  expect(detail.getByText(/İşlem büyüklüğü hesabı için giriş/)).toBeInTheDocument();
});

test('araştırma bağlantısı sürekli canlı çalışan gibi etiketlenmez', async () => {
  const response = state([]);
  response.status = { mode: 'delayed-research', running: true, heartbeatMaxAgeMs: 90000,
    lastHeartbeatAt: new Date(Date.now() - 60000).toISOString() };
  tradeRequest.mockResolvedValue(response);
  render(<TradePage />);
  expect(await screen.findByText('Araştırma verisi kontrol ediliyor')).toBeInTheDocument();
  expect(screen.getByText('Araştırma verisi kontrol ediliyor').querySelector('span')).not.toHaveClass('bg-gain');
});

test('gecikmeli araştırma fiyatı zamanıyla ve iki video stratejisiyle görünür; canlı sinyal sayılmaz', async () => {
  const item=candidate({availability:'delayed-research',status:'watch',referencePrice:123.45,entry:123.45,
    dataQuality:{realtime:false,quoteTime:'2026-11-13T21:00:00Z',barTime:'2026-11-13T20:59:00Z'},
    videoStrategies:[{id:'choch-fib-pullback',title:'CHoCH + Fibonacci dönüşü',sourceUrl:'https://x.com/nanaT3__7717/status/2120810656308113711',direction:'long',state:'zone',lastBarTime:new Date(Date.now()-60000).toISOString(),
      reasons:['Kırılım sonrası dönüş bölgesinde.'],assumptions:['1 dakikalık kapanmış mumlar.'],levels:{entryLow:122,entryHigh:124,stopLoss:121,targetPrice:130,rewardRisk:2.33}},
    {id:'parallel-channel-reversal',title:'Paralel kanal dönüşü',state:'watch',lastBarTime:new Date(Date.now()-60000).toISOString(),reasons:['Üst kanal izleniyor.'],assumptions:['Onaylanmış dip ve tepeler.'],setups:[{direction:'short',state:'watch',levels:{entryLow:129,entryHigh:131,stopLoss:132,targetPrice:123,rewardRisk:2.33}}]}]});
  const response=state([item]);response.status.mode='delayed-research';response.status.researchAvailable=true;
  tradeRequest.mockResolvedValue(response);render(<TradePage />);
  const card=await screen.findByRole('button',{name:'AAPL trade detayını aç'});
  expect(within(card).getByText('123,45 USD')).toBeInTheDocument();
  expect(within(card).getByText(/Fiyat zamanı/)).toBeInTheDocument();
  expect(screen.getByText('Araştırma fiyatları hazır')).toBeInTheDocument();
  expect(screen.queryByText('Koşullar uygun')).not.toBeInTheDocument();
  fireEvent.click(card);const detail=within(screen.getByRole('dialog'));
  expect(detail.getByRole('status')).toHaveTextContent('son seans araştırması');
  expect(detail.getByRole('region',{name:'Video stratejileri'})).toBeInTheDocument();
  expect(detail.getByText('CHoCH + Fibonacci dönüşü')).toBeInTheDocument();
  expect(detail.getByText('Short / düşüş')).toBeInTheDocument();
  expect(detail.getByRole('link',{name:'Kaynak video'})).toHaveAttribute('href',item.videoStrategies[0].sourceUrl);
  fireEvent.click(screen.getByRole('button',{name:'Trade detayını kapat'}));
  fireEvent.click(screen.getByRole('button',{name:'Verileri kontrol et'}));
  await waitFor(()=>expect(tradeRequest).toHaveBeenCalledTimes(2));
});

test('yenileme kesilince açık detay ve kart eski video teyidini güncel gibi göstermez', async () => {
  vi.useFakeTimers();
  const item=candidate({availability:'delayed-research',status:'blocked',videoStrategies:[{id:'channel',title:'Kanal analizi',state:'confirmed',lastBarTime:new Date(Date.now()-60000).toISOString(),reasons:[],assumptions:[]}]});
  tradeRequest.mockResolvedValueOnce(state([item])).mockImplementation(()=>new Promise(()=>{}));render(<TradePage />);
  await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  const card=screen.getByRole('button',{name:'AAPL trade detayını aç'});
  expect(within(card).getByText(/Kanal \/ Fibonacci deseni/)).toBeInTheDocument();
  fireEvent.click(card);
  const detail=within(screen.getByRole('dialog'));
  expect(detail.getByText('Mum teyidi görüldü')).toBeInTheDocument();
  await act(async()=>{await vi.advanceTimersByTimeAsync(301000);});
  expect(within(card).queryByText(/Kanal \/ Fibonacci deseni/)).not.toBeInTheDocument();
  expect(detail.queryByText('Mum teyidi görüldü')).not.toBeInTheDocument();
  expect(detail.getByText(/gösterilen seviyeler geçmiş araştırma/)).toBeInTheDocument();
});

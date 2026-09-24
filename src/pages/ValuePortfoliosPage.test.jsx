import { render,screen,waitFor,fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import ValuePortfoliosPage from './ValuePortfoliosPage.jsx';
import { automationRequest } from '../services/automation.js';
vi.mock('../services/automation.js',() => ({automationRequest:vi.fn()}));
beforeEach(() => { vi.clearAllMocks(); });
test('manuel tercihleri kuyruğa gönderir ve ikinci çalıştırmayı engeller',async () => {
  automationRequest.mockResolvedValueOnce({versions:[],job:null}).mockResolvedValueOnce({id:'job'})
    .mockResolvedValue({versions:[],job:{id:'job',status:'queued',preferences:{}}});
  render(<ValuePortfoliosPage />);
  const run=screen.getByRole('button',{name:/Algoritmayı çalıştır/});
  await waitFor(() => expect(run).toBeEnabled());
  fireEvent.change(screen.getByLabelText('ABD hisse kodu'),{target:{value:'AAPL'}});
  fireEvent.click(screen.getByRole('button',{name:'Ekle'}));
  fireEvent.click(run);
  await waitFor(() => expect(automationRequest).toHaveBeenCalledWith('value',{method:'POST',body:{preferences:{'quality-defense':{include:['AAPL'],exclude:[]}}}}));
  expect(await screen.findByRole('button',{name:'Analiz sırada'})).toBeDisabled();
});
test('kurulum hatasında hayalî sepet üretmez',async () => {
  automationRequest.mockRejectedValue(new Error('Veri bağlantısı kurulmamış.'));
  render(<ValuePortfoliosPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Veri bağlantısı kurulmamış.');
  expect(screen.getByRole('button',{name:/Algoritmayı çalıştır/})).toBeDisabled();
});

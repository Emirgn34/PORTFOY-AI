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

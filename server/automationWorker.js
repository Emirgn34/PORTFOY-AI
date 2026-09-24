import { automationDb, recordMonitor, checked } from './automationDb.js';
import { processValuePortfolioJob } from './valuePortfolioWorker.js';
import { scanStoredCatalysts, translateStoredCatalysts } from './catalystNews.js';
import { refreshSourcePortfolios } from './sourcePortfolios.js';
import { scanFreeNews } from './freeNews.js';

const sb=automationDb();
const mode=process.env.AUTOMATION_MODE || 'quick';
if (!['quick','news','value','sources'].includes(mode)) throw new Error('Geçersiz otomasyon modu.');
if (mode==='sources') {
  try { await refreshSourcePortfolios(sb); }
  catch (error) { await recordMonitor(sb,'sources',{ok:false,error:error.message}); throw error; }
} else {
  // Zamanlayıcı haber ve değer işlerini ayrı concurrency gruplarında çalıştırır.
  if (mode !== 'value') {
    try {
      const result=await scanFreeNews(sb);
      console.log('[free-news]',JSON.stringify(result));
      if (!result.feeds.length) process.exitCode=1;
    }
    catch (error) { console.error('[free-news]',error.message); process.exitCode=1; }
    try { await scanStoredCatalysts(sb,{reportStatus:false}); }
    catch (error) { console.error('[catalysts]',error.message); }
    console.log('[catalyst-translations]',JSON.stringify(await translateStoredCatalysts(sb)));
  }
  if (mode !== 'news') {
    for (let i=0;i<3;i++) { if (!await processValuePortfolioJob(sb)) break; }
  }
}
if (mode !== 'value') {
  const statuses=checked(await sb.from('monitor_status').select('id,updated_at,data').in('id',['news','sources']));
  console.log('[monitor]',JSON.stringify(statuses.map(({id,updated_at,data})=>({id,updated_at,ok:data.ok,connected:data.connected,checkedCount:data.checkedCount,rankedCount:data.rankedCount}))));
}

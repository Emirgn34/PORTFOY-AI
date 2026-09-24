import { automationDb, recordMonitor } from './automationDb.js';
import { processValuePortfolioJob } from './valuePortfolioWorker.js';
import { scanStoredCatalysts } from './catalystNews.js';
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
    try { await scanFreeNews(sb); }
    catch (error) { console.error('[free-news]',error.message); }
    try { await scanStoredCatalysts(sb,{reportStatus:false}); }
    catch (error) { console.error('[catalysts]',error.message); }
  }
  if (mode !== 'news') {
    for (let i=0;i<3;i++) { if (!await processValuePortfolioJob(sb)) break; }
  }
}

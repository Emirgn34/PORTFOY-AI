import { automationDb } from './automationDb.js';
import { scanFreeNews } from './freeNews.js';
import { translateStoredCatalysts } from './catalystNews.js';
const sb=automationDb();
let running=false;
async function tick() {
  if(running)return;
  running=true;
  try{
    const result=await scanFreeNews(sb,{intervalSeconds:60,runner:'daemon'});
    if (!result.skipped) {
      try { await translateStoredCatalysts(sb,{limit:6}); }
      catch { console.warn('[free-news] Çeviriler sonraki turda yeniden denenecek.'); }
    }
  }
  catch(error){console.error('[free-news]',error.message);}
  finally{running=false;}
}
const timer=setInterval(tick,60000);
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>clearInterval(timer));
await tick();

import { automationDb } from './automationDb.js';
import { scanFreeNews } from './freeNews.js';
import { translateStoredCatalysts } from './catalystNews.js';
const sb=automationDb();
let running=false;
async function tick() {
  if(running)return;
  running=true;
  try{
    // 50 sn tik: SQL kilidi (claim_news_scan) iki tarama arasını zaten 45 sn'de
    // sınırlar; daha sık tiklemek kilit tarafından güvenle emilir.
    const result=await scanFreeNews(sb,{intervalSeconds:50,runner:'daemon'});
    if (!result.skipped) {
      try { await translateStoredCatalysts(sb,{limit:6}); }
      catch { console.warn('[free-news] Çeviriler sonraki turda yeniden denenecek.'); }
    }
  }
  catch(error){console.error('[free-news]',error.message);}
  finally{running=false;}
}
const timer=setInterval(tick,50000);
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>clearInterval(timer));
await tick();

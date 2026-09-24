import { automationDb, recordMonitor } from './automationDb.js';
import { scanFreeNews } from './freeNews.js';
const sb=automationDb();
let running=false;
async function tick() {
  if(running)return;
  running=true;
  try{await scanFreeNews(sb,{intervalSeconds:60});}
  catch(error){await recordMonitor(sb,'news',{mode:'rss',connected:false,error:error.message}).catch(()=>{});}
  finally{running=false;}
}
await tick();
const timer=setInterval(tick,60000);
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>clearInterval(timer));

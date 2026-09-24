import { classifyCatalyst, ingestCatalyst, parsePressReleaseFeed } from './catalystNews.js';
import { checked, recordMonitor } from './automationDb.js';
import { deliverNotifications } from './pushNotifications.js';

export const FREE_NEWS_FEEDS = [
  {provider:'PR Newswire',url:'https://www.prnewswire.com/rss/news-releases-list.rss'},
  {provider:'PR Newswire',url:'https://www.prnewswire.com/rss/financial-services-latest-news/earnings-list.rss'},
  {provider:'PR Newswire',url:'https://www.prnewswire.com/rss/financial-services-latest-news/earnings-forecasts-projections-list.rss'},
  {provider:'GlobeNewswire',url:'https://www.globenewswire.com/RssFeed/subjectcode/1-Earnings%20Releases%20and%20Operating%20Results/feedTitle/GlobeNewswire%20-%20Earnings%20Releases%20and%20Operating%20Results'},
];

export async function scanFreeNews(sb, { intervalSeconds = 300, fetchImpl = fetch } = {}) {
  const errors=[], feeds=[];
  let articles=0, matches=0;
  for (const feed of FREE_NEWS_FEEDS) {
    try {
      const response=await fetchImpl(feed.url,{signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const items=parsePressReleaseFeed(await response.text(),feed.provider);
      articles+=items.length;
      for (const article of items) {
        if (!classifyCatalyst(article.title)) continue;
        if (await ingestCatalyst(sb,article)) matches++;
      }
      feeds.push(feed.url);
    } catch (error) { errors.push(`${feed.provider}: ${error.message}`); }
  }
  const previous=checked(await sb.from('monitor_status').select('*').eq('id','news').maybeSingle());
  if (!(previous?.data?.mode==='stream' && previous.data.connected && Date.now()-Date.parse(previous.updated_at)<90000)) {
    await recordMonitor(sb,'news',{mode:'rss',connected:feeds.length>0,intervalSeconds,articles,matches,feeds,errors,
      note:`Ücretsiz basın açıklaması akışları ${intervalSeconds} saniyelik aralıkla planlanır. Kaynak ve zamanlayıcı gecikebilir; tüm ABD haberlerini kapsamaz.`});
  }
  await deliverNotifications(sb);
  return {articles,matches,feeds,errors};
}

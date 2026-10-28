import { ingestCatalystBatch, parsePressReleaseFeed } from './catalystNews.js';
import { checked, recordMonitor } from './automationDb.js';
import { deliverNotifications } from './pushNotifications.js';
import { mapLimit } from './concurrency.js';

export const FREE_NEWS_FEEDS = [
  {provider:'PR Newswire',url:'https://www.prnewswire.com/rss/news-releases-list.rss'},
  {provider:'PR Newswire',url:'https://www.prnewswire.com/rss/financial-services-latest-news/earnings-list.rss'},
  {provider:'PR Newswire',url:'https://www.prnewswire.com/rss/financial-services-latest-news/earnings-forecasts-projections-list.rss'},
  {provider:'GlobeNewswire',url:'https://www.globenewswire.com/RssFeed/subjectcode/1-Earnings%20Releases%20and%20Operating%20Results/feedTitle/GlobeNewswire%20-%20Earnings%20Releases%20and%20Operating%20Results'},
];

export async function scanFreeNews(sb, { intervalSeconds = 300, runner = 'github', fetchImpl = fetch,
  send = deliverNotifications, ingest = ingestCatalystBatch, now = () => new Date() } = {}) {
  const token = checked(await sb.rpc('claim_news_scan'));
  if (!token) return { skipped: true, reason: 'recent-or-running', feeds: [] };
  const startedAt = now();
  try {
    const previous = checked(await sb.from('monitor_status').select('*').eq('id','news').maybeSingle());
    const errors = [], deliveryErrors = [], feeds = [];
    let articles = 0, matches = 0, inserted = 0;
    let requested = 0, processed = 0, deliveryChain = Promise.resolve();
    function deliverSoon() {
      requested++;
      deliveryChain = deliveryChain.then(async () => {
        if (processed === requested) return;
        processed = requested;
        try { await send(sb); }
        catch { deliveryErrors.push('Bildirim gönderimi tamamlanamadı; sonraki turda yeniden denenecek.'); }
      });
    }
    const feedChecks = await mapLimit(FREE_NEWS_FEEDS, 4, async (feed) => {
      const started = now();
      const cached = previous?.data?.feedChecks?.find((item) => item.url === feed.url);
      const headers = { Accept: 'application/rss+xml, application/xml, text/xml' };
      if (cached?.cacheReady && cached.etag) headers['If-None-Match'] = cached.etag;
      if (cached?.cacheReady && cached.lastModified) headers['If-Modified-Since'] = cached.lastModified;
      try {
        const response = await fetchImpl(feed.url, { headers, signal: AbortSignal.timeout(8000) });
        let result = { matches: 0, inserted: 0 }, items = [];
        if (response.status === 304) {
          if (!cached?.cacheReady) throw new Error('Önceki başarılı kayıt olmadan 304 yanıtı alındı.');
        } else {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          items = parsePressReleaseFeed(await response.text(), feed.provider);
          articles += items.length;
          result = await ingest(sb, items, { now: now() });
          matches += result.matches; inserted += result.inserted;
          if (result.inserted) deliverSoon();
        }
        feeds.push(feed.url);
        const dates = items.map((item) => Date.parse(item.publishedAt)).filter(Number.isFinite);
        return { url: feed.url, provider: feed.provider, ok: true, cacheReady: true,
          checkedAt: now().toISOString(), durationMs: now() - started, notModified: response.status === 304,
          etag: response.headers.get('etag') || (response.status === 304 ? cached.etag : null),
          lastModified: response.headers.get('last-modified') || (response.status === 304 ? cached.lastModified : null),
          latestPublishedAt: dates.length ? new Date(Math.max(...dates)).toISOString() : cached?.latestPublishedAt || null,
          articles: items.length, inserted: result.inserted };
      } catch (error) {
        const message = error.name === 'TimeoutError' ? 'Kaynak 8 saniyede yanıt vermedi.' : error.message;
        errors.push(`${feed.provider}: ${message}`);
        return { ...cached, url: feed.url, provider: feed.provider, ok: false,
          checkedAt: now().toISOString(), durationMs: now() - started, error: message };
      }
    });
    // A pending push must be retried even when no source has new articles.
    deliverSoon();
    await deliveryChain;
    const successfulChecks = feedChecks.filter((item) => item.ok).map((item) => item.checkedAt).sort();
    const result = { mode: 'rss', runner, connected: feeds.length > 0, intervalSeconds,
      startedAt: startedAt.toISOString(), durationMs: now() - startedAt,
      lastSuccessfulCheckAt: successfulChecks.at(-1) || previous?.data?.lastSuccessfulCheckAt || null,
      articles, matches, inserted, feeds, feedChecks, errors, deliveryErrors,
      note: `Ücretsiz basın açıklamaları ${intervalSeconds} saniyede bir planlı kontrol edilir. Kaynak yayınları gecikebilir; tüm ABD haberlerini kapsamaz.` };
    if (!(previous?.data?.mode === 'stream' && previous.data.connected && now() - Date.parse(previous.updated_at) < 90000)) {
      await recordMonitor(sb, 'news', result);
    }
    return result;
  } finally {
    checked(await sb.rpc('release_news_scan', { p_token: token }));
  }
}

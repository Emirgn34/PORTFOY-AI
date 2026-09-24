import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { checked, recordMonitor } from './automationDb.js';
import { deliverNotifications } from './pushNotifications.js';
import { translateToTurkish } from './marketData.js';
import { mapLimit } from './concurrency.js';

const RULES = [
  ['guidance-raised', 'Gelir / kâr tahmini yükseldi', /\b(?:raises?|raised|hikes?|increases?|increased|boosts?|boosted)\b.{0,80}\b(?:guidance|outlook|forecast|revenue estimate|sales estimate)|\b(?:guidance|outlook|forecast)\b.{0,60}\b(?:raised|increased|higher|above)\b|(?:gelir|kâr|kar|satış).{0,45}(?:tahmin|beklenti|öngörü).{0,35}yükselt/i],
  ['earnings-beat', 'Beklenti üstü sonuç', /\b(?:earnings|revenue|sales|eps)\b.{0,50}\b(?:beats?|tops?|exceeds?|above)\b.{0,30}\b(?:estimates?|expectations?|consensus)\b|beklentilerin üzerinde.{0,30}(?:gelir|kâr|kar)/i],
  ['approval', 'Düzenleyici onay', /\bFDA\b.{0,50}\b(?:approves?|approval|clears?)\b/i],
  ['contract', 'Yeni büyük sözleşme', /\b(?:wins?|secures?|awarded)\b.{0,70}\b(?:contract|order|deal)\b/i],
];
export function classifyCatalyst(title = '') {
  if (/\b(?:not|no|denies?|cuts?|lowers?|withdraws?|rumou?r|may|could|expected to|preview)\b|yalanla|düşürd|düşür|bekleniyor/i.test(title)) return null;
  const rule = RULES.find(([, , pattern]) => pattern.test(title));
  return rule ? { type: rule[0], label: rule[1] } : null;
}
export function catalystEvent(article, now = new Date()) {
  const classification = classifyCatalyst(article.title);
  const published = Date.parse(article.publishedAt);
  if (!classification || !Number.isFinite(published) || published > now.getTime() + 60_000) return null;
  const symbols = [...new Set((article.symbols ?? []).map((s) => String(s).toUpperCase()).filter((s) => /^[A-Z][A-Z0-9-]{0,9}$/.test(s)))];
  if (!symbols.length) return null;
  let sourceUrl;
  try { sourceUrl = new URL(article.url); } catch { return null; }
  if (sourceUrl.protocol !== 'https:') return null;
  const id = createHash('sha256').update(`${article.provider}:${article.id || sourceUrl.href}`).digest('hex');
  return { id, topic: 'catalyst', title: `${symbols.join(', ')} · ${classification.label}`,
    body: article.title.slice(0, 400), url: `/news?tab=catalysts&event=${id}`,
    published_at: new Date(published).toISOString(), detected_at: now.toISOString(),
    expires_at: new Date(published + 15 * 60_000).toISOString(),
    data: { symbols, ...classification, source: article.provider, sourceUrl: sourceUrl.href, originalTitle: article.title.slice(0,1200),
      latencySeconds: Math.max(0, Math.round((now.getTime() - published) / 1000)),
      timing: /after.hours|post.market|piyasa sonrası|seans sonrası/i.test(article.title) ? 'Piyasa sonrası' : null },
  };
}
export async function localizeCatalystEvent(event, { translate = translateToTurkish, titleTr = null, timeoutMs = 1500, now = new Date() } = {}) {
  if (event.data.titleTr) return event;
  const originalTitle=event.data.originalTitle || event.body;
  let translated=titleTr;
  if (!translated) {
    try { translated=await translate(originalTitle,{timeoutMs}); } catch { translated=null; }
  }
  translated=typeof translated==='string' ? translated.trim() : '';
  return {...event,
    body:translated ? translated.slice(0,400) : `${event.data.symbols.join(', ')}: ${event.data.label}. Ayrıntılar kaynak haberde.`,
    data:{...event.data,originalTitle,titleTr:translated || null,translationStatus:translated?'translated':'pending',translationAttemptedAt:now.toISOString()},
  };
}
export async function ingestCatalyst(sb, article, options = {}) {
  const event = catalystEvent(article);
  if (!event) return false;
  const existing=checked(await sb.from('notification_events').select('id').eq('id',event.id).maybeSingle());
  if (existing) return true;
  const localized=await localizeCatalystEvent(event,{...options,titleTr:article.titleTr});
  // İlk algılama zamanı ve kimlik korunur. Güncelleme tekrar bildirim üretmez.
  checked(await sb.from('notification_events').upsert(localized, { onConflict: 'id', ignoreDuplicates: true }));
  return true;
}
export async function translateStoredCatalysts(sb, { translate = translateToTurkish, now = new Date() } = {}) {
  const rows=checked(await sb.from('notification_events').select('*').eq('topic','catalyst').is('data->>titleTr',null).order('published_at',{ascending:false}).limit(100));
  const pending=rows.filter((row)=>!row.data.translationAttemptedAt || now.getTime()-Date.parse(row.data.translationAttemptedAt)>=15*60_000);
  let translated=0;
  await mapLimit(pending,3,async (row)=>{
    const localized=await localizeCatalystEvent(row,{translate,timeoutMs:2500,now});
    // Yalnızca metin güncellenir; olay tarihi, son kullanım ve teslim kayıtları korunur.
    checked(await sb.from('notification_events').update({body:localized.body,data:localized.data}).eq('id',row.id).is('data->>titleTr',null));
    if(localized.data.titleTr) translated++;
  });
  return {checked:pending.length,translated,pending:pending.length-translated};
}
// Anahtarsız fallback yalnızca mevcut haber kapsamını kontrol eder; gerçek zamanlı diye sunulmaz.
export async function scanStoredCatalysts(sb, { reportStatus = true } = {}) {
  const articles = checked(await sb.from('news').select('id,symbol,title,title_tr,link,published_at,publisher')
    .gte('published_at', new Date(Date.now() - 24 * 3600_000).toISOString()).order('published_at', { ascending: false }).limit(1000));
  let matches = 0;
  for (const article of articles) {
    if (String(article.symbol).endsWith('.IS')) continue;
    if (await ingestCatalyst(sb, { id: article.id, symbols: [article.symbol], title: article.title, titleTr:article.title_tr,
      url: article.link, publishedAt: article.published_at, provider: article.publisher || 'Haber arşivi' })) matches++;
  }
  const status = checked(await sb.from('monitor_status').select('*').eq('id','news').maybeSingle());
  if (reportStatus && !(status?.data?.mode === 'stream' && status.data.connected && Date.now()-Date.parse(status.updated_at)<90000)) {
    await recordMonitor(sb, 'news', { mode: 'scheduled', matches, note: 'Mevcut haber arşivi. Toplayıcı 20 dakikada bir planlanır; zamanlayıcı ve kaynak gecikebilir.' });
  }
  await deliverNotifications(sb);
}

// RSS kaynağı opsiyoneldir; yalnızca sunucudaki sabit listeden alınır.
export function parsePressReleaseFeed(xml, provider) {
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
  if (!parsed?.rss?.channel) throw new Error('Haber kaynağından geçerli RSS alınamadı.');
  const entries = parsed?.rss?.channel?.item ?? [];
  return (Array.isArray(entries) ? entries : [entries]).map((entry) => {
    const title = String(entry.title ?? '');
    const description = String(entry.description ?? '').replace(/<[^>]+>/g, ' ');
    const symbols = [...`${title} ${description}`.matchAll(/(?:NASDAQ|NYSE|AMEX)\s*[:：]\s*([A-Z][A-Z0-9.-]{0,9})/gi)].map((m) => m[1].replace('.', '-'));
    return { id: typeof entry.guid === 'object' ? entry.guid['#text'] : entry.guid,
      title, symbols, provider, url: entry.link, publishedAt: entry.pubDate };
  });
}

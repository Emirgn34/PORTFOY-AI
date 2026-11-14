import YahooFinance from 'yahoo-finance2';
import { automationDb } from './automationDb.js';
import { parseSymbols, SYMBOL_PATTERN } from './apiGuards.js';
import { fetchNewsForSymbolRaw, fetchGoogleNews, dedupeByTitle } from './marketData.js';
import { buildNewsSignals } from './newsHeuristics.js';
import { summarizeNewsForTrading } from './newsTrading.js';
import { safeNewsUrl } from '../src/utils/newsUrls.js';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const cache = new Map();
function bounded(promise, ms = 9000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Haber kaynağı zaman aşımı.')), ms); })]).finally(() => clearTimeout(timer));
}
async function cached(key, loader) {
  const existing = cache.get(key);
  if (existing && Date.now() - existing.at < 10 * 60_000) return existing.promise;
  const promise = bounded(loader()).catch((err) => { cache.delete(key); throw err; });
  cache.set(key, { at: Date.now(), promise });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return promise;
}
const fromRow = (r) => ({ id: r.id, symbol: r.symbol, title: r.title, titleTr: r.title_tr, publisher: r.publisher,
  link: r.link, publishedAt: r.published_at, sentiment: r.sentiment, reliability: r.reliability, aiSummaryTr: r.ai_summary_tr });

export function normalizeNewsArticle(article, now = new Date()) {
  if (!article || typeof article.title !== 'string' || !article.title.trim()) return null;
  const published = Date.parse(article.publishedAt);
  if (Number.isFinite(published) && published > now.getTime() + 60000) return null;
  const link = safeNewsUrl(article.link);
  return { ...article, id: article.id ?? link ?? `${article.symbol ?? 'sector'}-${article.title}`,
    symbol: SYMBOL_PATTERN.test(String(article.symbol ?? '')) ? article.symbol : null,
    title: article.title.trim().slice(0, 1600), link, publishedAt: Number.isFinite(published) ? new Date(published).toISOString() : null,
    publisher: String(article.publisher ?? 'Bilinmeyen kaynak').slice(0, 160) };
}

export function createNewsHandler({ getDb = automationDb, loadNews = (symbol) => cached(`news:${symbol}`, () => fetchNewsForSymbolRaw(yahoo, symbol)),
  searchNews = (query) => cached(`query:${query}`, () => fetchGoogleNews(query, null)),
  loadChart = (symbol) => cached(`chart:${symbol}`, () => yahoo.chart(symbol, { period1: new Date(Date.now() - 150 * 86400_000), interval: '1d' })), now = () => new Date() } = {}) {
  return async function newsHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return res.status(405).json({ error: 'Yöntem desteklenmiyor.' });
    const token = /^Bearer (.+)$/.exec(String(req.headers?.authorization ?? ''))?.[1];
    if (!token) return res.status(401).json({ error: 'Haberler için hesabınıza giriş yapın.' });
    let sb;
    try { sb = getDb(); } catch { return res.status(503).json({ error: 'Haber sunucu bağlantısı kurulmamış.' }); }
    try {
      const auth = await sb.auth.getUser(token);
      if (auth.error || !auth.data?.user) return res.status(401).json({ error: 'Geçersiz oturum.' });
      const action = req.query?.action ?? 'feed';
      if (!['feed', 'implications'].includes(action)) return res.status(400).json({ error: 'Geçersiz haber işlemi.' });
      const rawSymbol = String(req.query?.symbol ?? '').trim().toUpperCase();
      if (rawSymbol && !SYMBOL_PATTERN.test(rawSymbol)) return res.status(400).json({ error: 'Geçersiz hisse kodu.' });
      const symbols = rawSymbol ? [rawSymbol] : parseSymbols(req.query?.symbols, { limit: 25 });
      const query = String(req.query?.q ?? '').trim().slice(0, 120);
      const limit = Math.max(1, Math.min(400, Number(req.query?.limit) || 200));
      if (action === 'implications' && !symbols.length && query.length < 2) return res.status(400).json({ error: 'Şirket, sektör veya hisse seçin.' });
      // Fetch the price history alongside headlines, not after another timeout.
      const analysisSymbol = action === 'implications' && symbols.length === 1 ? symbols[0] : null;
      const chartResult = analysisSymbol ? Promise.resolve().then(() => loadChart(analysisSymbol)).then((value) => ({ value }), () => ({ failed: true })) : Promise.resolve({ value: null });
      let stored = [];
      if (!query || symbols.length) {
        let request = sb.from('news').select('*').order('published_at', { ascending: false, nullsFirst: false }).limit(limit);
        if (symbols.length) request = request.in('symbol', symbols);
        const result = await request;
        // A missing collector table does not prevent on-demand public news.
        if (!result.error) stored = (result.data ?? []).map(fromRow);
      }
      const latest = Math.max(0, ...stored.map((a) => Date.parse(a.publishedAt) || 0));
      const dueSymbols = symbols.filter((symbol) => {
        const latestForSymbol = Math.max(0, ...stored.filter((a) => a.symbol === symbol).map((a) => Date.parse(a.publishedAt) || 0));
        return now().getTime() - latestForSymbol > 30 * 60_000;
      });
      let fresh = [];
      const warnings = [];
      if (query && !symbols.length) {
        try { fresh = await searchNews(query); } catch { warnings.push('Sektör haber kaynağı şu an yanıt vermiyor.'); }
      } else if (dueSymbols.length || !stored.length || (!symbols.length && now().getTime() - latest > 30 * 60_000) || action === 'implications') {
        const fetchSymbols = (symbols.length ? action === 'implications' ? symbols : dueSymbols : ['AAPL', 'MSFT', 'THYAO.IS']).slice(0, 4);
        const outcomes = await Promise.allSettled(fetchSymbols.map((s) => loadNews(s)));
        fresh = outcomes.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
        if (outcomes.some((r) => r.status === 'rejected')) warnings.push('Bazı haber kaynakları yanıt vermedi; alınabilen haberler gösteriliyor.');
      }
      const articles = dedupeByTitle([...fresh, ...stored].map((a) => normalizeNewsArticle(a, now())).filter(Boolean)).map((a) => ({ ...a, ...buildNewsSignals(a) }))
        .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)).slice(0, limit);
      if (action === 'feed') return res.json({ articles, warnings, fetchedAt: now().toISOString() });
      const history = await chartResult;
      if (history.failed) warnings.push('Fiyat geçmişi alınamadı; sayısal aralık üretilmedi.');
      return res.json({ articles, warnings, analysis: summarizeNewsForTrading(articles, { symbol: analysisSymbol, query, chart: history.value, now: now() }) });
    } catch {
      return res.status(503).json({ error: 'Haberler şu an alınamadı. Yeniden deneyin.' });
    }
  };
}

export default createNewsHandler();

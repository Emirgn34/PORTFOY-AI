/** Resmî SEC EDGAR veri katmanı: şirket bildirimleri ve 13F hareketleri. */

const SEC_DATA = 'https://data.sec.gov';
const SEC_WWW = 'https://www.sec.gov';
const CACHE = new Map();
let requestQueue = Promise.resolve();
let lastRequestAt = 0;

export const INSTITUTIONAL_MANAGERS = [
  { slug: 'berkshire', name: 'Berkshire Hathaway', cik: '0001067983' },
  { slug: 'bridgewater', name: 'Bridgewater Associates', cik: '0001350694' },
  { slug: 'renaissance', name: 'Renaissance Technologies', cik: '0001037389' },
];

function secUserAgent() {
  const configured = process.env.SEC_USER_AGENT?.trim();
  if (configured) return configured;
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new Error('SEC_USER_AGENT zorunludur (ör. PortfoyAI/1.0 iletisim@alanadiniz.com).');
  }
  return 'PortfoyAI/1.0 local-development@example.invalid';
}

async function cached(key, ttlMs, loader) {
  const hit = CACHE.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await loader();
  CACHE.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/** İstekleri sıralayıp SEC'nin 10 istek/sn sınırının güvenli biçimde altında tutar. */
async function secFetch(url, { responseType = 'json' } = {}) {
  const task = requestQueue.then(async () => {
    const userAgent = secUserAgent();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const waitMs = Math.max(0, 150 - (Date.now() - lastRequestAt));
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      let response;
      try {
        response = await fetch(url, {
          headers: {
            'User-Agent': userAgent,
            Accept: responseType === 'json' ? 'application/json' : 'application/xml,text/xml,text/plain',
          },
          signal: AbortSignal.timeout(12_000),
        });
      } catch (error) {
        lastRequestAt = Date.now();
        if (attempt === 3) throw new Error(`SEC bağlantısı kurulamadı: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
        continue;
      }
      lastRequestAt = Date.now();
      if (response.ok) return responseType === 'json' ? response.json() : response.text();
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await new Promise((resolve) =>
          setTimeout(resolve, Number.isFinite(retryAfter) ? retryAfter * 1000 : attempt * 1000)
        );
        continue;
      }
      throw new Error(`SEC ${response.status}: veri alınamadı`);
    }
    throw new Error('SEC veri isteği tamamlanamadı.');
  });
  requestQueue = task.catch(() => undefined);
  return task;
}

function normalizeTicker(symbol) {
  return String(symbol ?? '').trim().toUpperCase().replace(/-/g, '.');
}

async function getTickerMap() {
  return cached('sec-tickers', 24 * 60 * 60 * 1000, async () => {
    const raw = await secFetch(`${SEC_WWW}/files/company_tickers.json`);
    const map = new Map();
    for (const item of Object.values(raw ?? {})) {
      if (!item?.ticker || item?.cik_str == null) continue;
      map.set(normalizeTicker(item.ticker), {
        cik: String(item.cik_str).padStart(10, '0'),
        ticker: item.ticker,
        companyName: item.title,
      });
    }
    return map;
  });
}

export async function lookupSecCompany(symbol) {
  const map = await getTickerMap();
  const normalized = normalizeTicker(symbol);
  return map.get(normalized) ?? map.get(normalized.replace('.', '-')) ?? null;
}

async function getSubmissions(cik) {
  const padded = String(cik).padStart(10, '0');
  return cached(`submissions:${padded}`, 15 * 60 * 1000, () =>
    secFetch(`${SEC_DATA}/submissions/CIK${padded}.json`)
  );
}

function recentFilings(submissions) {
  const recent = submissions?.filings?.recent ?? {};
  const length = recent.form?.length ?? 0;
  return Array.from({ length }, (_, index) => ({
    accessionNumber: recent.accessionNumber?.[index] ?? null,
    filingDate: recent.filingDate?.[index] ?? null,
    reportDate: recent.reportDate?.[index] ?? null,
    acceptanceDateTime: recent.acceptanceDateTime?.[index] ?? null,
    form: recent.form?.[index] ?? null,
    primaryDocument: recent.primaryDocument?.[index] ?? null,
    primaryDocDescription: recent.primaryDocDescription?.[index] ?? null,
  }));
}

function archiveBase(cik, accessionNumber) {
  const cikNumber = String(Number(cik));
  return `${SEC_WWW}/Archives/edgar/data/${cikNumber}/${accessionNumber.replace(/-/g, '')}`;
}

function decorateFiling(cik, filing) {
  const base = archiveBase(cik, filing.accessionNumber);
  return {
    ...filing,
    documentUrl: filing.primaryDocument ? `${base}/${filing.primaryDocument}` : base,
    source: 'SEC EDGAR',
  };
}

export async function getCompanyFilings(
  symbol,
  { forms = ['10-K', '10-Q', '8-K'], limit = 12 } = {}
) {
  const company = await lookupSecCompany(symbol);
  if (!company) throw new Error(`${symbol} için SEC şirket kaydı bulunamadı.`);
  const submissions = await getSubmissions(company.cik);
  const allowed = new Set(forms.map((form) => form.toUpperCase()));
  const filings = recentFilings(submissions)
    .filter((filing) => allowed.has(String(filing.form).toUpperCase()))
    .slice(0, Math.min(40, Math.max(1, Number(limit) || 12)))
    .map((filing) => decorateFiling(company.cik, filing));
  return {
    company: { ...company, companyName: submissions?.name ?? company.companyName },
    filings,
    fetchedAt: new Date().toISOString(),
    sourceUrl: 'https://www.sec.gov/edgar/search/',
  };
}

function decodeXml(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function tag(block, name) {
  const match = block.match(
    new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, 'i')
  );
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : null;
}

export function parse13FInformationTable(xml, { legacyThousands = false } = {}) {
  const blocks = [
    ...String(xml ?? '').matchAll(
      /<(?:[\w-]+:)?infoTable(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?infoTable>/gi
    ),
  ];
  return blocks
    .map((match) => {
      const block = match[1];
      const cusip = tag(block, 'cusip');
      if (!cusip) return null;
      return {
        issuer: tag(block, 'nameOfIssuer') ?? 'Bilinmeyen ihraççı',
        titleOfClass: tag(block, 'titleOfClass'),
        cusip,
        // SEC, 3 Ocak 2023'ten beri Column 4 değerini bin dolar yerine
        // en yakın dolar olarak ister. Eski dosyalar çağıran tarafından açıkça
        // legacyThousands=true ile ölçeklenir.
        valueUsd: (Number(tag(block, 'value')) || 0) * (legacyThousands ? 1000 : 1),
        shares: Number(tag(block, 'sshPrnamt')) || 0,
        shareType: tag(block, 'sshPrnamtType'),
        putCall: tag(block, 'putCall'),
        discretion: tag(block, 'investmentDiscretion'),
      };
    })
    .filter(Boolean);
}

async function get13FHoldings(cik, filing) {
  const base = archiveBase(cik, filing.accessionNumber);
  const index = await cached(`13f-index:${filing.accessionNumber}`, 24 * 60 * 60 * 1000, () =>
    secFetch(`${base}/index.json`)
  );
  const items = index?.directory?.item ?? [];
  const xmlFile =
    items.find((item) => /info.*table.*\.xml$/i.test(item.name)) ??
    items.find(
      (item) =>
        /\.xml$/i.test(item.name) && !/primary|form13f|xsl|schema|cal|def|lab|pre/i.test(item.name)
    );
  if (!xmlFile) throw new Error('13F bilgi tablosu bulunamadı.');
  const xml = await cached(`13f-xml:${filing.accessionNumber}`, 24 * 60 * 60 * 1000, () =>
    secFetch(`${base}/${xmlFile.name}`, { responseType: 'text' })
  );
  const filedAt = Date.parse(filing.filingDate ?? filing.reportDate ?? '');
  const legacyThousands = Number.isFinite(filedAt) && filedAt < Date.UTC(2023, 0, 3);
  return parse13FInformationTable(xml, { legacyThousands });
}

function holdingKey(holding) {
  return [holding.cusip, holding.titleOfClass ?? '', holding.putCall ?? 'SHARES'].join('|');
}

function aggregate13F(holdings) {
  const aggregated = new Map();
  for (const holding of holdings ?? []) {
    const key = holdingKey(holding);
    const existing = aggregated.get(key);
    if (!existing) {
      aggregated.set(key, { ...holding });
      continue;
    }
    existing.shares += holding.shares ?? 0;
    existing.valueUsd += holding.valueUsd ?? 0;
  }
  return aggregated;
}

export function compare13F(current, previous) {
  // Aynı CUSIP'teki adi hisse, PUT ve CALL satırlarını birbirine ezdirmeden;
  // aynı araç birden fazla manager/discretion satırına bölünmüşse toplayarak kıyasla.
  const currentMap = aggregate13F(current);
  const previousMap = aggregate13F(previous);
  const moves = [];
  for (const key of new Set([...currentMap.keys(), ...previousMap.keys()])) {
    const now = currentMap.get(key) ?? null;
    const before = previousMap.get(key) ?? null;
    const sharesNow = now?.shares ?? 0;
    const sharesBefore = before?.shares ?? 0;
    const changeShares = sharesNow - sharesBefore;
    let action = 'unchanged';
    if (!before && now) action = 'new';
    else if (before && !now) action = 'exited';
    else if (changeShares > 0) action = 'increased';
    else if (changeShares < 0) action = 'decreased';
    const baseShares = Math.abs(sharesBefore);
    moves.push({
      cusip: now?.cusip ?? before?.cusip ?? null,
      issuer: now?.issuer ?? before?.issuer ?? 'Bilinmeyen ihraççı',
      titleOfClass: now?.titleOfClass ?? before?.titleOfClass ?? null,
      putCall: now?.putCall ?? before?.putCall ?? null,
      action,
      shares: sharesNow,
      previousShares: sharesBefore,
      changeShares,
      changePercent:
        baseShares > 0 ? Number(((changeShares / baseShares) * 100).toFixed(1)) : now ? 100 : -100,
      valueUsd: now?.valueUsd ?? 0,
      previousValueUsd: before?.valueUsd ?? 0,
      materialityUsd: Math.abs((now?.valueUsd ?? 0) - (before?.valueUsd ?? 0)),
    });
  }
  return moves
    .filter((move) => move.action !== 'unchanged')
    .sort((a, b) => b.materialityUsd - a.materialityUsd);
}

export async function getInstitutionalMoves(managerSlug, { limit = 30 } = {}) {
  const manager = INSTITUTIONAL_MANAGERS.find((item) => item.slug === managerSlug);
  if (!manager) throw new Error('Bilinmeyen kurumsal yönetici.');
  const submissions = await getSubmissions(manager.cik);
  const reports = recentFilings(submissions)
    // Recent liste yeni tarihten eskiye gelir; aynı rapor dönemindeki amendment
    // özgün dosyadan sonra verildiği için findIndex en güncel etkin kaydı seçer.
    .filter((filing) => filing.form === '13F-HR' || filing.form === '13F-HR/A')
    .filter((filing, index, list) => list.findIndex((item) => item.reportDate === filing.reportDate) === index)
    .slice(0, 2);
  if (reports.length < 2) throw new Error('Karşılaştırma için iki 13F dönemi bulunamadı.');
  const [current, previous] = await Promise.all([
    get13FHoldings(manager.cik, reports[0]),
    get13FHoldings(manager.cik, reports[1]),
  ]);
  return {
    manager,
    currentReport: decorateFiling(manager.cik, reports[0]),
    previousReport: decorateFiling(manager.cik, reports[1]),
    moves: compare13F(current, previous).slice(0, Math.min(100, Math.max(1, Number(limit) || 30))),
    note: '13F verileri çeyreklik ve gecikmelidir; CUSIP kodları SEC kaynağından aynen korunur.',
    fetchedAt: new Date().toISOString(),
  };
}

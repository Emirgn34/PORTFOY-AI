/**
 * ABD hisse senedi evreni (Faz 1 tarama girdisi).
 *
 * Nasdaq Trader'ın halka açık sembol dizini dosyalarından (ücretsiz, anahtarsız)
 * NYSE + Nasdaq + AMEX'te işlem gören düz hisseleri çeker. ETF, test ihracı ve
 * imtiyazlı/varant gibi düz olmayan semboller elenir. Sonuç Supabase'de
 * `us_universe` tablosunda önbelleğe alınır ve haftada bir yenilenir; böylece
 * her aday turunda ~1 MB dosya tekrar indirilmez.
 *
 * Tek başına test: node -e "import('./server/usUniverse.js').then(m=>m.fetchUsUniverse().then(u=>console.log(u.length, u.slice(0,5))))"
 */

const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt';
const OTHER_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt';

/** Yalnızca düz hisse sembolleri (1-5 harf; imtiyazlı/varant/unit '.', '$' içerenler elenir). */
const PLAIN_SYMBOL = /^[A-Z]{1,5}$/;

/**
 * Düz olmayan araçları şirket adından eler: varant, hak (rights), unit, imtiyazlı,
 * tahvil/senet. ADR/ADS (yabancı hisseler) KORUNUR — onlar yatırılabilir.
 * Not: 5 harfli SPAC türevleri (AACBU=Units, AACIW=Warrant) sembol süzgecini
 * geçer ama isim süzgeciyle burada elenir.
 */
const DERIVATIVE_NAME = /\b(warrants?|rights?|units?|preferred|debentures?|notes?|when[- ]issued)\b/i;

/**
 * Pipe-delimited Nasdaq Trader dosyasını satır nesnelerine ayrıştırır.
 * İlk satır başlık, son satır "File Creation Time" altbilgisidir (ikisi de atlanır).
 */
function parsePipeFile(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const header = lines[0].split('|');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startsWith('File Creation Time')) continue; // altbilgi
    const cols = lines[i].split('|');
    if (cols.length !== header.length) continue;
    const row = {};
    header.forEach((h, idx) => (row[h] = cols[idx]));
    rows.push(row);
  }
  return rows;
}

/** nasdaqlisted.txt → düz hisseler. Sütunlar: Symbol|Security Name|...|Test Issue|...|ETF|... */
function parseNasdaqListed(text) {
  return parsePipeFile(text)
    .filter(
      (r) =>
        r['Test Issue'] === 'N' &&
        r['ETF'] === 'N' &&
        PLAIN_SYMBOL.test(r['Symbol']) &&
        !DERIVATIVE_NAME.test(r['Security Name'] ?? '')
    )
    .map((r) => ({ symbol: r['Symbol'], name: r['Security Name'] ?? null, exchange: 'NASDAQ' }));
}

/** otherlisted.txt (NYSE/AMEX) → düz hisseler. Sütunlar: ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|...|Test Issue|... */
function parseOtherListed(text) {
  const exchMap = { N: 'NYSE', A: 'NYSE American', P: 'NYSE Arca', Z: 'BATS', V: 'IEX' };
  return parsePipeFile(text)
    .filter(
      (r) =>
        r['Test Issue'] === 'N' &&
        r['ETF'] === 'N' &&
        PLAIN_SYMBOL.test(r['ACT Symbol']) &&
        !DERIVATIVE_NAME.test(r['Security Name'] ?? '')
    )
    .map((r) => ({
      symbol: r['ACT Symbol'],
      name: r['Security Name'] ?? null,
      exchange: exchMap[r['Exchange']] ?? r['Exchange'] ?? 'NYSE',
    }));
}

/**
 * Tüm ABD düz hisse evrenini Nasdaq Trader'dan çeker (~6000 sembol).
 * Sembole göre tekilleştirir (aynı hisse iki dosyada görünebilir).
 */
export async function fetchUsUniverse() {
  const [nasdaqText, otherText] = await Promise.all([
    fetch(NASDAQ_LISTED_URL).then((r) => {
      if (!r.ok) throw new Error(`nasdaqlisted ${r.status}`);
      return r.text();
    }),
    fetch(OTHER_LISTED_URL).then((r) => {
      if (!r.ok) throw new Error(`otherlisted ${r.status}`);
      return r.text();
    }),
  ]);

  const all = [...parseNasdaqListed(nasdaqText), ...parseOtherListed(otherText)];
  const seen = new Set();
  const out = [];
  for (const row of all) {
    if (seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    out.push(row);
  }
  return out;
}

/** Evren tablosunun en eski (önbelleğin yaşını veren) yenileme zamanı kaç gün önce? */
function ageDays(refreshedAt) {
  if (!refreshedAt) return Infinity;
  return (Date.now() - new Date(refreshedAt).getTime()) / (24 * 60 * 60 * 1000);
}

/**
 * ABD evren sembollerini döndürür; tablo boş veya bayatsa (maxAgeDays'ten eski)
 * Nasdaq Trader'dan yeniden çeker ve `us_universe` tablosuna yazar.
 *
 * sb: collect.js'deki PostgREST yardımcısı (pathAndQuery, { method, body, prefer }).
 * Dönüş: Yahoo formatında sembol dizisi (ABD sembolleri sade; .IS yok).
 */
export async function getUsUniverse(sb, { maxAgeDays = 7 } = {}) {
  let rows = [];
  try {
    rows = (await sb('us_universe?select=symbol,refreshed_at&order=refreshed_at.asc')) ?? [];
  } catch {
    rows = [];
  }

  const stale = rows.length === 0 || ageDays(rows[0]?.refreshed_at) > maxAgeDays;
  if (!stale) return rows.map((r) => r.symbol);

  console.log('ABD evreni boş/bayat; Nasdaq Trader\'dan yenileniyor...');
  let universe;
  try {
    universe = await fetchUsUniverse();
  } catch (err) {
    console.error(`[universe] çekme hatası: ${err.message}`);
    // Çekemezsek elimizdeki (bayat olsa da) listeyle devam et
    return rows.map((r) => r.symbol);
  }
  if (universe.length === 0) return rows.map((r) => r.symbol);

  const refreshed_at = new Date().toISOString();
  // Parçalar hâlinde upsert (tek istekte ~6000 satır PostgREST'i zorlayabilir)
  const CHUNK = 1000;
  for (let i = 0; i < universe.length; i += CHUNK) {
    const batch = universe.slice(i, i + CHUNK).map((u) => ({ ...u, refreshed_at }));
    await sb('us_universe', { method: 'POST', body: batch, prefer: 'resolution=merge-duplicates' });
  }
  console.log(`ABD evreni yenilendi: ${universe.length} sembol.`);
  return universe.map((u) => u.symbol);
}

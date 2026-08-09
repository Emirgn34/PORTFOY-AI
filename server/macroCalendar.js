/** ABD makro takvimi: BLS ICS + resmî FOMC toplantı takvimi. */

const BLS_ICS_URL = 'https://www.bls.gov/schedule/news_release/bls.ics';
const FED_CALENDAR_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';

// Fed'in yayımladığı 2026-2027 toplantı bitiş tarihleri. Karar saati 14:00 ET.
const FOMC_DATES = [
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
  '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
  '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09',
  '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08',
];

function timeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return (
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second)
    ) - date.getTime()
  );
}

function newYorkLocalToUtc(year, month, day, hour, minute, second = 0) {
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let result = wallClockUtc;
  // İlk tahmin DST sınırına yakınsa ikinci tur gerçek UTC anındaki ofseti düzeltir.
  for (let attempt = 0; attempt < 2; attempt++) {
    const offset = timeZoneOffsetMs(new Date(result), 'America/New_York');
    result = wallClockUtc - offset;
  }
  return new Date(result);
}

function parseIcsDate(raw) {
  const value = String(raw ?? '').trim();
  const match = value.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?/);
  if (!match) return null;
  const [, y, mo, d, h = '08', mi = '30', s = '00'] = match;
  const hasZulu = value.endsWith('Z');
  if (hasZulu) {
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  }
  return newYorkLocalToUtc(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s));
}

function unfoldIcs(text) {
  return String(text ?? '').replace(/\r?\n[ \t]/g, '');
}

function classifyBls(summary) {
  if (/consumer price index/i.test(summary)) return { code: 'CPI', title: 'ABD TÜFE (CPI)', impact: 'high' };
  if (/employment situation/i.test(summary)) return { code: 'NFP', title: 'Tarım Dışı İstihdam (NFP)', impact: 'high' };
  if (/producer price index/i.test(summary)) return { code: 'PPI', title: 'ABD ÜFE (PPI)', impact: 'medium' };
  if (/job openings|jolts/i.test(summary)) return { code: 'JOLTS', title: 'JOLTS Açık İş Sayısı', impact: 'medium' };
  if (/employment cost index/i.test(summary)) return { code: 'ECI', title: 'İstihdam Maliyet Endeksi', impact: 'medium' };
  return null;
}

export function parseBlsCalendarIcs(text) {
  const events = [];
  for (const block of unfoldIcs(text).split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const summary = body.match(/^SUMMARY(?:;[^:]*)?:(.*)$/mi)?.[1]?.trim() ?? '';
    const classified = classifyBls(summary);
    if (!classified) continue;
    const rawDate = body.match(/^DTSTART(?:;[^:]*)?:(.*)$/mi)?.[1];
    const date = parseIcsDate(rawDate);
    if (!date || Number.isNaN(date.getTime())) continue;
    events.push({
      id: `bls-${classified.code}-${date.toISOString()}`,
      ...classified,
      date: date.toISOString(),
      source: 'U.S. Bureau of Labor Statistics',
      sourceUrl: BLS_ICS_URL,
      status: 'scheduled',
    });
  }
  return events;
}

function fomcEvents() {
  return FOMC_DATES.map((day) => {
    const [year, month, date] = day.split('-').map(Number);
    const at = newYorkLocalToUtc(year, month, date, 14, 0, 0);
    return {
      id: `fed-fomc-${day}`,
      code: 'FOMC',
      title: 'FED Faiz Kararı ve Basın Toplantısı',
      impact: 'high',
      date: at.toISOString(),
      source: 'Federal Reserve',
      sourceUrl: FED_CALENDAR_URL,
      status: 'scheduled',
    };
  });
}

export async function getMacroCalendar({ days = 90, now = new Date() } = {}) {
  let bls = [];
  let blsAvailable = true;
  try {
    const response = await fetch(BLS_ICS_URL, {
      headers: { 'User-Agent': 'PortfoyAI/1.0 macro calendar' },
    });
    if (!response.ok) throw new Error(`BLS ${response.status}`);
    bls = parseBlsCalendarIcs(await response.text());
  } catch {
    blsAvailable = false;
  }
  const from = now.getTime() - 24 * 60 * 60 * 1000;
  const until = now.getTime() + Math.max(7, Math.min(365, Number(days) || 90)) * 24 * 60 * 60 * 1000;
  const events = [...bls, ...fomcEvents()]
    .filter((event) => {
      const time = new Date(event.date).getTime();
      return time >= from && time <= until;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  return {
    events,
    coverage: { bls: blsAvailable, fed: true },
    fetchedAt: new Date().toISOString(),
  };
}

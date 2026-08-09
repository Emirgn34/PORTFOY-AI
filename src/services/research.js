import { toYahooSymbol } from './liveData.js';

async function getJson(url) {
  try {
    const response = await fetch(url);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Veri alınamadı.');
    return body;
  } catch (error) {
    return { error: error.message || 'Bağlantı kurulamadı.' };
  }
}

export async function fetchMarketIntelligence(stocks, { includeOptions = true } = {}) {
  const symbols = [...new Set((stocks ?? []).map(toYahooSymbol).filter(Boolean))];
  if (!symbols.length) return { items: [] };
  // Sunucu tek istekte en fazla 20 sembol işler. Portföy + takip kapsamını
  // sessizce kırpmak yerine bütün kapsamı 20'li partiler halinde getir.
  const batches = [];
  for (let index = 0; index < symbols.length; index += 20) {
    batches.push(symbols.slice(index, index + 20));
  }
  const responses = await Promise.all(
    batches.map((batch) =>
      getJson(
        `/api/market-intelligence?symbols=${encodeURIComponent(batch.join(','))}&options=${includeOptions}`
      )
    )
  );
  const items = responses.flatMap((response) => response.items ?? []);
  const batchErrors = responses.filter((response) => response.error).map((response) => response.error);
  if (!items.length && batchErrors.length) {
    return { error: batchErrors[0], items: [], requestedCount: symbols.length };
  }
  return {
    items,
    requestedCount: symbols.length,
    batchErrors,
    partial: batchErrors.length > 0 || items.length < symbols.length,
  };
}

export async function fetchSecFilings(symbol, { forms = ['10-K', '10-Q', '8-K'], limit = 15 } = {}) {
  return getJson(
    `/api/sec-filings?symbol=${encodeURIComponent(symbol)}&forms=${encodeURIComponent(forms.join(','))}&limit=${limit}`
  );
}

export async function fetchInstitutionalManagers() {
  return getJson('/api/institutional');
}

export async function fetchInstitutionalMoves(manager, { limit = 30 } = {}) {
  return getJson(`/api/institutional?manager=${encodeURIComponent(manager)}&limit=${limit}`);
}

export async function fetchMacroCalendar({ days = 90 } = {}) {
  return getJson(`/api/macro-calendar?days=${days}`);
}

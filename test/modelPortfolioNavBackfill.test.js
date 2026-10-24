import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissingModelPortfolioNavRows } from '../server/modelPortfolioNavBackfill.js';

function fixture() {
  const versions = Array.from({length: 4}, (_, i) => ({
    version_key: `v${i}`, slug: `p${i}`, cycle_start: '2026-09-24T21:17:33Z', cycle_end: '2026-10-25T21:17:33Z',
    data: { cashWeightPct: 0, tracking: { startedAt: '2026-09-24T21:17:33Z', baseFxByCurrency: { USD: 30 } },
      holdings: [ {ticker:'WBD', currency:'USD',weightPct:50,currentPriceAtGeneration:30},
        {ticker:'AAA',currency:'USD',weightPct:50,currentPriceAtGeneration:100} ] },
  }));
  const dates = Array.from({length:9}, (_, i) => `2026-10-${16+i}`);
  const navRows = versions.flatMap(v => dates.filter(d => v.version_key !== 'v3' || d.endsWith('16') || d.endsWith('24'))
    .map(nav_date => ({version_key:v.version_key,nav_date})));
  const histories = {
    AAA: { quotes: dates.map(d => ({date:`${d}T13:30:00Z`,close:110})) },
    'USDTRY=X': { quotes: dates.map(d => ({date:`${d}T00:00:00Z`,close:33})) },
  };
  return {versions,navRows,histories,now:'2026-10-24T12:00:00Z'};
}

test('16–24 Ekim arasındaki yedi eksik momentum gününü kapanış ve kurla tamamlar; mevcut satırları korur', () => {
  const input = fixture();
  const rows = buildMissingModelPortfolioNavRows(input);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map(r => r.nav_date), Array.from({length:7}, (_,i) => `2026-10-${17+i}`));
  for (const row of rows) {
    assert.equal(row.version_key,'v3');
    assert.equal(row.coverage_pct,100);
    assert.equal(row.nav_value,117.36);
    assert.equal(row.benchmarks._valuation.method,'historical-close-reconstruction-v1');
  }
  assert.deepEqual(buildMissingModelPortfolioNavRows({...input,navRows:[...input.navRows,...rows]}),[]);
});

test('gelecekteki seansı kullanmaz; eksik veya bayat kurla onarım yayımlamaz', () => {
  const input = fixture();
  input.histories.AAA.quotes.push({date:'2026-10-17T13:30:00Z',close:999});
  assert.equal(buildMissingModelPortfolioNavRows(input)[0].nav_value,117.36);
  delete input.histories['USDTRY=X'];
  assert.throws(() => buildMissingModelPortfolioNavRows(input),/güncel kapanış yok/);
  input.histories['USDTRY=X']={quotes:[{date:'2026-10-01T00:00:00Z',close:33}]};
  assert.throws(() => buildMissingModelPortfolioNavRows(input),/güncel kapanış yok/);
});

test('sonraki split ile düzeltilmiş tarihsel kapanışı geri çevirir ve pay çarpanını bir kez uygular', () => {
  const input = fixture();
  input.histories.AAA.quotes = input.histories.AAA.quotes.map(row=>({...row,close:55}));
  input.histories.AAA.events={splits:[{date:new Date('2026-10-20T13:30:00Z'),numerator:2,denominator:1}]};
  const rows = buildMissingModelPortfolioNavRows(input);
  assert.equal(rows[0].nav_value,117.36);
  assert.equal(rows.at(-1).nav_value,117.36);
});

test('farklı dönemleri ve eksik portföy kümelerini karıştırmaz', () => {
  const input=fixture();
  input.versions[0].cycle_start='2026-10-01T00:00:00Z';
  assert.throws(()=>buildMissingModelPortfolioNavRows(input),/aynı dönemdeki dört/);
});

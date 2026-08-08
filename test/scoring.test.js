import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleAnnualReturnToHorizon } from '../server/candidateBuilder.js';
import { applySectorRelativeNormalization } from '../src/utils/opportunityScoringCore.js';

test('12 aylık hedef getiriyi bileşik olarak işlem gününe ölçekler', () => {
  assert.equal(Number(scaleAnnualReturnToHorizon(21, 252).toFixed(6)), 21);
  const twentyDay = scaleAnnualReturnToHorizon(21, 20);
  assert.ok(twentyDay > 1 && twentyDay < 2);
});

test('uzun vadeli faktörleri sektör içinde yüzdeliklerle harmanlar', () => {
  const candidates = [20, 40, 60, 80].map((value, index) => ({
    symbol: `S${index}`,
    market: 'US',
    sector: 'Tech',
    scoreBreakdown: {
      fundamentalHealthScore: value,
      valuationScore: value,
      growthScore: value,
    },
  }));
  const normalized = applySectorRelativeNormalization(candidates);
  assert.ok(normalized[0].scoreBreakdown.valuationScore < 20);
  assert.ok(normalized[3].scoreBreakdown.valuationScore > 80);
  assert.equal(candidates[0].scoreBreakdown.valuationScore, 20, 'girdi mutasyona uğramamalı');
});

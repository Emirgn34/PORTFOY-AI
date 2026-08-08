import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvidenceSignature,
  estimateClaudeCost,
} from '../server/aiControl.js';

test('Haiku maliyetini standart ve batch fiyatıyla hesaplar', () => {
  const usage = { input_tokens: 2_000, output_tokens: 1_000 };
  assert.equal(estimateClaudeCost(usage), 0.007);
  assert.equal(estimateClaudeCost(usage, { batch: true }), 0.0035);
});

test('kanıt imzası yaş değişiminden etkilenmez, metin değişiminden etkilenir', () => {
  const first = { evidence: [{ type: 'filing', text: '  Yeni sözleşme   açıklandı ', ageDays: 1 }] };
  const second = { evidence: [{ type: 'filing', text: 'Yeni sözleşme açıklandı', ageDays: 3 }] };
  const changed = { evidence: [{ type: 'filing', text: 'Sözleşme iptal edildi', ageDays: 3 }] };
  assert.equal(buildEvidenceSignature(first), buildEvidenceSignature(second));
  assert.notEqual(buildEvidenceSignature(first), buildEvidenceSignature(changed));
});

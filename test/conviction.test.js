import { test } from 'node:test';
import assert from 'node:assert/strict';

// Bu dosya kendi süreçinde koşar (node --test her test dosyasını ayrı süreçte
// çalıştırır), bu yüzden import ÖNCESİ env kurmak güvenlidir.

test('kesinlik eşiği ortam değişkeniyle deploy gerekmeden ayarlanabilir', async () => {
  process.env.CONVICTION_THRESHOLD = '72';
  const { CONVICTION_THRESHOLD } = await import('../src/utils/conviction.js');
  assert.equal(CONVICTION_THRESHOLD, 72);
});

test('geçersiz eşik değeri yok sayılır ve varsayılana düşer', async () => {
  process.env.CONVICTION_THRESHOLD = 'saçma';
  const { CONVICTION_THRESHOLD } = await import(
    '../src/utils/conviction.js?invalid'
  );
  assert.equal(CONVICTION_THRESHOLD, 78);
});

test('nihai puan: AI teyidi yoksa kural puanı aynen korunur', async () => {
  delete process.env.CONVICTION_THRESHOLD;
  const { finalizeConvictionScore } = await import('../src/utils/conviction.js?final1');
  assert.equal(finalizeConvictionScore({ ruleScore: 90 }), 90);
  assert.equal(finalizeConvictionScore({ ruleScore: 90, aiCertainty: null }), 90);
  assert.equal(finalizeConvictionScore(null), 0);
});

test('nihai puan: AI certainty çarpanı her çağrıda yeniden uygulanır', async () => {
  const { finalizeConvictionScore } = await import('../src/utils/conviction.js?final2');
  // certainty 0 → ×0.6, certainty 100 → ×1, certainty 50 → ×0.8
  assert.equal(finalizeConvictionScore({ ruleScore: 90, aiCertainty: 0 }), 54);
  assert.equal(finalizeConvictionScore({ ruleScore: 90, aiCertainty: 100 }), 90);
  assert.equal(finalizeConvictionScore({ ruleScore: 90, aiCertainty: 50 }), 72);
  // ruleScore alanı yoksa (eski satır) score taban alınır — geriye uyumluluk
  assert.equal(finalizeConvictionScore({ score: 80, aiCertainty: 50 }), 64);
});

test('olay nöbeti devralması: AI düşürmesi ham puana geri dönemez', async () => {
  const { finalizeConvictionScore, passesConvictionGate, CONVICTION_THRESHOLD } = await import(
    '../src/utils/conviction.js?final3'
  );
  // AI 90'ı 54'e indirmişti; nöbet aynı kanıt imzasıyla certainty'yi devralır
  const fresh = { ruleScore: 90, score: 90, categories: ['policy', 'technical'] };
  fresh.aiCertainty = 0; // önceki turdan devralındı
  fresh.score = finalizeConvictionScore(fresh);
  assert.equal(fresh.score, 54);
  assert.equal(passesConvictionGate(fresh), 54 >= CONVICTION_THRESHOLD);
  assert.equal(passesConvictionGate(fresh), false);
});

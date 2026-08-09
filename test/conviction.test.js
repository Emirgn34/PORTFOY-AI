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

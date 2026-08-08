import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsername, validateUsername } from '../server/accountSettings.js';

test('kullanıcı adı küçük harfe çevrilip kırpılır', () => {
  assert.equal(normalizeUsername('  Emir.GN_34  '), 'emir.gn_34');
});

test('geçerli kullanıcı adı kabul edilir', () => {
  assert.deepEqual(validateUsername('yatirimci-34'), {
    username: 'yatirimci-34',
    error: null,
  });
});

test('boşluk ve geçersiz karakter içeren kullanıcı adı reddedilir', () => {
  assert.match(validateUsername('iki kelime').error, /3-32 karakter/i);
  assert.match(validateUsername('ab').error, /3-32 karakter/i);
});

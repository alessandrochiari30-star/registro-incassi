import test from 'node:test';
import assert from 'node:assert/strict';
import { resetGate, normalizePhrase, RESET_PHRASE } from '../js/reset.js';

test('nessun lucchetto salta: servono righe, backup e parola', () => {
  assert.deepEqual(resetGate({ backupDone: true, phrase: 'AZZERA', rowCount: 12 }), { enabled: true, reason: null });
});

test('senza backup non si azzera, nemmeno con la parola giusta', () => {
  const g = resetGate({ backupDone: false, phrase: 'AZZERA', rowCount: 12 });
  assert.equal(g.enabled, false);
  assert.equal(g.reason, 'backup');
});

test('col backup ma senza parola resta chiuso', () => {
  assert.equal(resetGate({ backupDone: true, phrase: '', rowCount: 12 }).reason, 'parola');
  assert.equal(resetGate({ backupDone: true, phrase: 'azzer', rowCount: 12 }).reason, 'parola');
  assert.equal(resetGate({ backupDone: true, phrase: 'cancella', rowCount: 12 }).reason, 'parola');
});

test('la parola tollera minuscole e spazi, niente altro', () => {
  assert.equal(normalizePhrase('  azzera '), RESET_PHRASE);
  assert.equal(resetGate({ backupDone: true, phrase: ' Azzera ', rowCount: 1 }).enabled, true);
  assert.equal(resetGate({ backupDone: true, phrase: 'AZ ZERA', rowCount: 1 }).enabled, false);
});

test('senza righe il tasto non si accende mai', () => {
  assert.equal(resetGate({ backupDone: true, phrase: 'AZZERA', rowCount: 0 }).reason, 'vuoto');
});

test('chiamata senza argomenti: chiuso, non esplode', () => {
  assert.deepEqual(resetGate(), { enabled: false, reason: 'vuoto' });
  assert.equal(normalizePhrase(undefined), '');
});

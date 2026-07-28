import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup, mergeBackup } from '../js/backup.js';

const r = (id, amountCents = 1000, extra = {}) =>
  ({ id, date: '2026-07-28', amountCents, channel: 'B', createdAt: 1, deletedAt: null, ...extra });

const wrap = (entries) =>
  JSON.stringify({ exportedAt: '2026-07-27T20:00:00.000Z', entries });

// ---------- parseBackup ----------

test('file vuoto o JSON rotto -> errore json', () => {
  assert.deepEqual(parseBackup(''), { ok: false, error: 'json' });
  assert.deepEqual(parseBackup('{"exportedAt":'), { ok: false, error: 'json' });
});

test('JSON valido ma non un backup -> errore formato', () => {
  assert.equal(parseBackup('42').error, 'formato');
  assert.equal(parseBackup('null').error, 'formato');
  assert.equal(parseBackup('[]').error, 'formato');
  assert.equal(parseBackup('{"altro": true}').error, 'formato');
});

test('entries non array -> errore formato', () => {
  const raw = JSON.stringify({ exportedAt: '2026-07-27', entries: 'niente' });
  assert.equal(parseBackup(raw).error, 'formato');
});

test('exportedAt mancante -> errore formato', () => {
  const raw = JSON.stringify({ entries: [r('a')] });
  assert.equal(parseBackup(raw).error, 'formato');
});

test('una sola riga malformata -> rifiuto di tutto il file', () => {
  const cases = [
    r('a', 12.5),                        // importo non intero
    r('a', -100),                        // importo negativo
    r('a', 1000, { channel: 'X' }),      // canale sconosciuto
    r('a', 1000, { date: '2026-13-05' }),// mese impossibile
    r('a', 1000, { date: '28/07/2026' }),// formato data sbagliato
    r('', 1000),                         // id vuoto
    r('a', 1000, { createdAt: 'ieri' }), // createdAt non numerico
    r('a', 1000, { deletedAt: 'si' }),   // deletedAt né null né numero
    'non un oggetto',
    null,
  ];
  for (const bad of cases) {
    const out = parseBackup(wrap([r('ok'), bad]));
    assert.equal(out.ok, false, JSON.stringify(bad));
    assert.equal(out.error, 'righe');
    assert.equal(out.badRows, 1);
  }
});

test('backup valido -> righe integre, cancellate incluse', () => {
  const entries = [r('a'), r('b', 2500, { deletedAt: 99, channel: 'C' })];
  const out = parseBackup(wrap(entries));
  assert.equal(out.ok, true);
  assert.deepEqual(out.entries, entries);
});

test('backup valido senza righe -> ok con lista vuota', () => {
  const out = parseBackup(wrap([]));
  assert.equal(out.ok, true);
  assert.deepEqual(out.entries, []);
});

// ---------- mergeBackup ----------

test('import su app vuota -> tutte le righe aggiunte', () => {
  const imported = [r('a'), r('b')];
  const out = mergeBackup([], imported);
  assert.equal(out.entries.length, 2);
  assert.equal(out.added, 2);
  assert.equal(out.existing, 0);
});

test('sovrapposizione parziale -> conteggi giusti, niente doppioni', () => {
  const current = [r('a'), r('b')];
  const imported = [r('b'), r('c')];
  const out = mergeBackup(current, imported);
  assert.equal(out.entries.length, 3);
  assert.equal(out.added, 1);
  assert.equal(out.existing, 1);
});

test('conflitto stesso id -> vince la riga locale (più recente del backup)', () => {
  const current = [r('a', 5000, { deletedAt: 123 })];
  const imported = [r('a', 9999)];
  const out = mergeBackup(current, imported);
  const a = out.entries.find((e) => e.id === 'a');
  assert.equal(a.amountCents, 5000);
  assert.equal(a.deletedAt, 123);
});

test('backup vecchio e più piccolo -> il risultato non si riduce mai', () => {
  const current = [r('a'), r('b'), r('c')];
  const imported = [r('a')];
  const out = mergeBackup(current, imported);
  assert.equal(out.entries.length, 3);
  assert.equal(out.added, 0);
  assert.equal(out.existing, 1);
  assert.ok(out.entries.length >= Math.max(current.length, imported.length));
});

test('id duplicati dentro il file -> una riga sola', () => {
  const out = mergeBackup([], [r('a', 1000), r('a', 2000)]);
  assert.equal(out.entries.length, 1);
  assert.equal(out.added, 1);
});

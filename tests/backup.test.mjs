import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from '../js/backup.js';

const r = (id, amountCents = 1000, extra = {}) =>
  ({ id, date: '2026-07-28', amountCents, channel: 'B', createdAt: 1, deletedAt: null, ...extra });

test('entrambi vuoti o null -> lista vuota, nessun recupero', () => {
  assert.deepEqual(reconcile(null, null), { entries: [], source: 'idb', recovered: false });
  assert.deepEqual(reconcile([], []), { entries: [], source: 'idb', recovered: false });
});

test('idb vuoto, mirror pieno -> recupero dal mirror', () => {
  const mirror = [r('a'), r('b')];
  const out = reconcile([], mirror);
  assert.equal(out.source, 'mirror');
  assert.equal(out.recovered, true);
  assert.equal(out.entries.length, 2);
});

test('mirror vuoto, idb pieno -> idb, nessun recupero', () => {
  const idb = [r('a')];
  const out = reconcile(idb, null);
  assert.equal(out.source, 'idb');
  assert.equal(out.recovered, false);
  assert.equal(out.entries.length, 1);
});

test('identici -> idb, nessun recupero', () => {
  const idb = [r('a'), r('b')];
  const mirror = [r('a'), r('b')];
  const out = reconcile(idb, mirror);
  assert.equal(out.source, 'idb');
  assert.equal(out.recovered, false);
  assert.equal(out.entries.length, 2);
});

test('mirror con righe in più -> union, mai risultato più piccolo', () => {
  const idb = [r('a')];
  const mirror = [r('a'), r('b'), r('c')];
  const out = reconcile(idb, mirror);
  assert.equal(out.source, 'union');
  assert.equal(out.recovered, true);
  assert.equal(out.entries.length, 3);
  assert.ok(out.entries.length >= Math.max(idb.length, mirror.length));
});

test('conflitto stesso id -> vince la versione idb', () => {
  const idb = [r('a', 5000)];
  const mirror = [r('a', 9999), r('b')];
  const out = reconcile(idb, mirror);
  const a = out.entries.find((e) => e.id === 'a');
  assert.equal(a.amountCents, 5000);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { importMessage } from '../js/month.js';

test('messaggio di import: solo incassi', () => {
  assert.equal(importMessage(1, 0), 'Backup caricato: 1 riga ripristinata.');
  assert.equal(importMessage(4, 0), 'Backup caricato: 4 righe ripristinate.');
  assert.equal(importMessage(4, 2), 'Backup caricato: 4 righe ripristinate, 2 erano già presenti.');
});

test('messaggio di import: dice anche le spese tornate indietro', () => {
  assert.equal(importMessage(2, 0, 1), 'Backup caricato: 2 righe ripristinate, più 1 voce di spesa.');
  assert.equal(importMessage(2, 1, 3), 'Backup caricato: 2 righe ripristinate, 1 era già presente, più 3 voci di spesa.');
});

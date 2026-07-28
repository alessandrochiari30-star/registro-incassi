import test from 'node:test';
import assert from 'node:assert/strict';
import { toCSV, toJSON } from '../js/exporter.js';

const FIX = [
  { id: 'x2', date: '2026-07-02', amountCents: 4550, channel: 'S', createdAt: 20, deletedAt: null },
  { id: 'x1', date: '2026-07-01', amountCents: 8000, channel: 'B', createdAt: 10, deletedAt: null },
  { id: 'x3', date: '2026-07-01', amountCents: 999, channel: 'C', createdAt: 5, deletedAt: null },
  { id: 'x4', date: '2026-07-01', amountCents: 1234, channel: 'B', createdAt: 7, deletedAt: 99 },
];

test('CSV: header, ordinamento per data poi createdAt, decimale con virgola, cancellate escluse', () => {
  const csv = toCSV(FIX);
  assert.equal(csv, 'data;canale;importo\n2026-07-01;C;9,99\n2026-07-01;B;80,00\n2026-07-02;S;45,50\n');
});

test('CSV: lista vuota -> solo header', () => {
  assert.equal(toCSV([]), 'data;canale;importo\n');
});

test('JSON: round-trip completo, incluse cancellate', () => {
  const parsed = JSON.parse(toJSON(FIX));
  assert.ok(parsed.exportedAt);
  assert.equal(parsed.entries.length, 4);
  const del = parsed.entries.find((e) => e.id === 'x4');
  assert.equal(del.deletedAt, 99);
});

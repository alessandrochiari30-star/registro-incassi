import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCents, todayISO, monthOf } from '../js/money.js';
import { dayTotals, monthStats, yearDeclared, prevMonthDelta, bigVisitShare } from '../js/totals.js';

const e = (date, amountCents, channel, deletedAt = null, createdAt = 1) =>
  ({ id: `${date}-${amountCents}-${channel}-${Math.random()}`, date, amountCents, channel, createdAt, deletedAt });

// Fixture: giugno + luglio 2026, canali misti, una riga cancellata.
const FIX = [
  e('2026-06-10', 5000, 'B'),
  e('2026-06-10', 2000, 'C'),
  e('2026-07-01', 8000, 'B'),
  e('2026-07-01', 3500, 'S'),
  e('2026-07-01', 2500, 'C'),
  e('2026-07-01', 9999, 'B', 12345), // cancellata: mai contata
  e('2026-07-15', 1500, 'R'),
  e('2026-07-15', 3000, 'C'),
  e('2026-07-15', 7700, 'B'),
  e('2025-12-31', 4000, 'B'), // anno diverso
];

test('formatCents formato italiano', () => {
  assert.equal(formatCents(4500), '45,00 €');
  assert.equal(formatCents(123456), '1.234,56 €');
  assert.equal(formatCents(5), '0,05 €');
  assert.equal(formatCents(0), '0,00 €');
});

test('todayISO è data locale YYYY-MM-DD', () => {
  const d = new Date();
  const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.equal(todayISO(), expected);
});

test('monthOf', () => {
  assert.equal(monthOf('2026-07-28'), '2026-07');
});

test('dayTotals somma per canale ed esclude cancellate', () => {
  const t = dayTotals(FIX, '2026-07-01');
  assert.deepEqual(t, { B: 8000, S: 3500, R: 0, C: 2500, total: 14000 });
});

test('monthStats: totali, visite, giorni lavorati, medie', () => {
  const s = monthStats(FIX, '2026-07');
  assert.equal(s.total, 26200);
  assert.deepEqual(s.byChannel, { B: 15700, S: 3500, R: 1500, C: 5500 });
  assert.equal(s.visits, 6);
  assert.equal(s.workedDays, 2);
  assert.equal(s.avgPerWorkedDay, 13100);
  assert.equal(s.avgVisit, 4367); // 26200/6 arrotondato
  assert.equal(s.avgVisitElectronic, 6400); // (8000+3500+7700)/3
  assert.equal(s.avgVisitCash, 2333); // (2500+3000+1500)/3
  assert.equal(s.perDay.length, 31);
  assert.equal(s.perDay[0].total, 14000); // 1 luglio
  assert.equal(s.perDay[14].total, 12200); // 15 luglio
  assert.equal(s.perDay[1].total, 0);
});

test('perDay: ogni giorno del mese con numero, totale e visite', () => {
  const s = monthStats(FIX, '2026-07');
  assert.equal(s.perDay.length, 31);
  assert.deepEqual(s.perDay[0], { date: '2026-07-01', day: 1, total: 14000, visits: 3 });
  assert.deepEqual(s.perDay[1], { date: '2026-07-02', day: 2, total: 0, visits: 0 });
  assert.deepEqual(s.perDay[14], { date: '2026-07-15', day: 15, total: 12200, visits: 3 });
  assert.equal(s.perDay[30].day, 31);
  // febbraio 2026 ha 28 giorni: nessun giorno inventato
  assert.equal(monthStats(FIX, '2026-02').perDay.length, 28);
});

test('monthStats su mese vuoto: zeri, niente NaN', () => {
  const s = monthStats(FIX, '2026-01');
  assert.equal(s.total, 0);
  assert.equal(s.visits, 0);
  assert.equal(s.avgVisit, 0);
  assert.equal(s.avgVisitElectronic, 0);
  assert.equal(s.avgPerWorkedDay, 0);
});

test('yearDeclared somma solo B+S+R anno corrente, esclude cancellate', () => {
  assert.equal(yearDeclared(FIX, 2026), 5000 + 8000 + 3500 + 1500 + 7700);
  assert.equal(yearDeclared(FIX, 2025), 4000);
});

test('prevMonthDelta', () => {
  const d = prevMonthDelta(FIX, '2026-07');
  assert.equal(d.prevTotal, 7000);
  assert.equal(d.deltaPct, 274); // (26200-7000)/7000 = +274%
  const empty = prevMonthDelta(FIX, '2026-06'); // maggio vuoto
  assert.equal(empty.prevTotal, 0);
  assert.equal(empty.deltaPct, null);
});

test('bigVisitShare: quanto pesano le visite da 50 € in su', () => {
  // luglio: 80,00 B · 35,00 S · 25,00 C · 15,00 R · 30,00 C · 77,00 B
  const s = bigVisitShare(FIX, '2026-07', 5000);
  assert.equal(s.visits, 6);
  assert.equal(s.bigVisits, 2); // 80,00 e 77,00
  assert.equal(s.bigTotal, 15700);
  assert.equal(s.total, 26200);
  assert.equal(s.pctVisits, 33);
  assert.equal(s.pctTotal, 60);
});

test('bigVisitShare su mese vuoto: zeri, niente divisioni per zero', () => {
  const s = bigVisitShare(FIX, '2026-01', 5000);
  assert.deepEqual([s.visits, s.bigVisits, s.pctVisits, s.pctTotal], [0, 0, 0, 0]);
});

test('cambio anno nel delta: gennaio guarda dicembre', () => {
  const d = prevMonthDelta(FIX, '2026-01');
  assert.equal(d.prevTotal, 4000);
});

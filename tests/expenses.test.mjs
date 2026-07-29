import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseExpenseInput, DEFAULT_EXPENSE_LABEL, DEFAULT_FIXED_CENTS, DEFAULT_HOME_CENTS,
  FIXED_ID, FIXED_HOME_ID,
  fixedEntry, fixedAmount, fixedTotal, variableItems, variableTotal, dayVariableItems,
  dailyFixedShare, workDaysInMonth, isOpenDay, dayFixedShare,
  dayBalance, monthBalance, breakEvenDay,
} from '../js/expenses.js';

const fixed = (amountCents, deletedAt = null) =>
  ({ id: FIXED_ID, kind: 'fixed', label: 'Spese attività', amountCents, date: null, createdAt: 1, deletedAt });
const casa = (amountCents, deletedAt = null) =>
  ({ id: FIXED_HOME_ID, kind: 'fixed', label: 'Spese casa', amountCents, date: null, createdAt: 1, deletedAt });
const spesa = (date, amountCents, label = 'spesa', deletedAt = null) =>
  ({ id: `${date}-${amountCents}-${label}`, kind: 'var', label, amountCents, date, createdAt: 1, deletedAt });

test('parseExpenseInput: importo davanti o in fondo', () => {
  assert.deepEqual(parseExpenseInput('40 shopping'), { amountCents: 4000, label: 'shopping' });
  assert.deepEqual(parseExpenseInput('100 spesa'), { amountCents: 10000, label: 'spesa' });
  assert.deepEqual(parseExpenseInput('12,50 benzina'), { amountCents: 1250, label: 'benzina' });
  assert.deepEqual(parseExpenseInput('cena fuori 35'), { amountCents: 3500, label: 'cena fuori' });
});

test('parseExpenseInput: senza voce mette un\'etichetta di comodo', () => {
  assert.deepEqual(parseExpenseInput('40'), { amountCents: 4000, label: DEFAULT_EXPENSE_LABEL });
});

test('parseExpenseInput: rifiuta ciò che non ha un importo', () => {
  assert.equal(parseExpenseInput('shopping'), null);
  assert.equal(parseExpenseInput(''), null);
  assert.equal(parseExpenseInput('   '), null);
  assert.equal(parseExpenseInput(undefined), null);
  assert.equal(parseExpenseInput('0 niente'), null); // zero non è una spesa
});

test('voci fisse: due, e senza si parte dai valori di partenza', () => {
  assert.equal(fixedTotal([]), DEFAULT_FIXED_CENTS + DEFAULT_HOME_CENTS);
  assert.equal(fixedTotal([fixed(200000)]), 200000 + DEFAULT_HOME_CENTS);
  assert.equal(fixedTotal([fixed(200000), casa(50000)]), 250000);
  assert.equal(fixedEntry([fixed(200000, 999)]), null); // cancellata
  assert.equal(fixedTotal([fixed(200000, 999)]), DEFAULT_FIXED_CENTS + DEFAULT_HOME_CENTS);
  assert.equal(fixedTotal([fixed(0), casa(0)]), 0); // azzerarle è una scelta valida
});

test('le due voci fisse non si confondono fra loro', () => {
  const extras = [fixed(111100), casa(222200)];
  assert.equal(fixedAmount(extras, FIXED_ID), 111100);
  assert.equal(fixedAmount(extras, FIXED_HOME_ID), 222200);
  assert.equal(fixedEntry(extras, FIXED_HOME_ID).amountCents, 222200);
  // casa salvata a zero resta zero: non ricade sul valore di partenza
  assert.equal(fixedAmount([casa(0)], FIXED_HOME_ID), 0);
  assert.equal(fixedAmount([casa(0)], FIXED_ID), DEFAULT_FIXED_CENTS);
});

test('spese variabili: filtrate per mese e per giorno, cancellate escluse', () => {
  const extras = [
    fixed(135036),
    spesa('2026-07-03', 4000, 'shopping'),
    spesa('2026-07-03', 10000, 'spesa'),
    spesa('2026-07-20', 2500, 'benzina'),
    spesa('2026-07-21', 9900, 'errore', 12345), // cancellata
    spesa('2026-06-30', 5000, 'giugno'),
  ];
  assert.equal(variableItems(extras, '2026-07').length, 3);
  assert.equal(variableTotal(extras, '2026-07'), 16500);
  assert.equal(dayVariableItems(extras, '2026-07-03').length, 2);
  assert.equal(variableTotal(extras, '2026-08'), 0);
});

test('quota giornaliera delle fisse', () => {
  assert.equal(dailyFixedShare(225036, 25), 9001); // 90,01 €
  assert.equal(dailyFixedShare(135036, 24), 5627);
  assert.equal(dailyFixedShare(0, 25), 0);
  assert.equal(dailyFixedShare(135036, 0), 0); // niente divisioni per zero
});

test('giornate di lavoro: sabato mezzo, domenica chiusa', () => {
  assert.equal(workDaysInMonth('2026-07'), 25); // 31 gg, 4 sab, 4 dom
  assert.equal(workDaysInMonth('2026-08'), 23.5); // 5 sab, 5 dom
  assert.equal(workDaysInMonth('2026-02'), 22);
  assert.equal(workDaysInMonth(''), 0);
  assert.equal(workDaysInMonth('2026-13'), 0); // mese impossibile, non 0 giorni veri
});

test('giorni di apertura: tutti tranne la domenica', () => {
  assert.equal(isOpenDay('2026-07-25'), true); // sabato
  assert.equal(isOpenDay('2026-07-26'), false); // domenica
  assert.equal(isOpenDay('2026-07-27'), true); // lunedì
  assert.equal(isOpenDay(''), false);
});

test('quota del giorno: uguale nei giorni aperti, zero di domenica', () => {
  assert.equal(dayFixedShare(225036, '2026-07-27'), 9001); // lunedì
  assert.equal(dayFixedShare(225036, '2026-07-25'), 9001); // sabato: stessa quota
  assert.equal(dayFixedShare(225036, '2026-07-26'), 0); // domenica
  assert.equal(dayFixedShare(0, '2026-07-27'), 0);
});

test('conto della giornata', () => {
  const b = dayBalance({ incomeCents: 12000, variableCents: 4000, fixedShareCents: 4356 });
  assert.equal(b.outflow, 8356);
  assert.equal(b.netCents, 3644);
  assert.equal(dayBalance().netCents, 0);
  assert.equal(dayBalance({ incomeCents: 1000, fixedShareCents: 4356 }).netCents, -3356);
});

test('conto del mese', () => {
  const b = monthBalance({ incomeCents: 300000, fixedCents: 135036, variableCents: 16500 });
  assert.equal(b.outflow, 151536);
  assert.equal(b.netCents, 148464);
});

const perDay = (totals) => totals.map((total, i) => ({ day: i + 1, date: `2026-07-0${i + 1}`, total, visits: 0 }));

test('giorno di pareggio: quando il cumulato copre le uscite', () => {
  const p = perDay([10000, 10000, 10000, 10000]);
  assert.deepEqual(breakEvenDay(p, 25000), { day: 3, missingCents: 0 });
  assert.deepEqual(breakEvenDay(p, 10000), { day: 1, missingCents: 0 });
});

test('pareggio non ancora arrivato: dice quanto manca', () => {
  const p = perDay([10000, 10000]);
  assert.deepEqual(breakEvenDay(p, 50000), { day: null, missingCents: 30000 });
});

test('pareggio con uscite a zero: niente da coprire, nessun giorno', () => {
  assert.deepEqual(breakEvenDay(perDay([1000]), 0), { day: null, missingCents: 0 });
});

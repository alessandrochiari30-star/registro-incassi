import test from 'node:test';
import assert from 'node:assert/strict';
import { axisDays, dailyBarsSVG } from '../js/chart.js';

const perDay = (n, totals = {}) =>
  Array.from({ length: n }, (_, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, '0')}`,
    day: i + 1,
    total: totals[i + 1] ?? 0,
    visits: totals[i + 1] ? 1 : 0,
  }));

const count = (s, needle) => s.split(needle).length - 1;

test('axisDays: uno ogni tre giorni', () => {
  assert.deepEqual(axisDays(31), [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31]);
});

test('axisDays: ultimo giorno aggiunto solo se non si appiccica', () => {
  assert.deepEqual(axisDays(30), [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 30]);
  // 29: l'ultima etichetta della serie è 28, troppo vicina
  assert.deepEqual(axisDays(29), [1, 4, 7, 10, 13, 16, 19, 22, 25, 28]);
  assert.deepEqual(axisDays(28), [1, 4, 7, 10, 13, 16, 19, 22, 25, 28]);
});

test('una colonna toccabile per ogni giorno, anche i giorni a zero', () => {
  const svg = dailyBarsSVG(perDay(31, { 3: 12000 }));
  assert.equal(count(svg, 'class="day-col"'), 31);
  assert.equal(count(svg, 'class="hit"'), 31);
  assert.ok(svg.includes('data-day="1"'));
  assert.ok(svg.includes('data-day="31"'));
});

test('la barra esiste solo dove c\'è incasso', () => {
  const svg = dailyBarsSVG(perDay(31, { 3: 12000, 10: 4000 }));
  assert.equal(count(svg, 'class="bar"'), 2);
});

test('etichette dell\'asse solo sui giorni previsti', () => {
  const svg = dailyBarsSVG(perDay(31, { 3: 12000 }));
  assert.equal(count(svg, 'class="lbl"'), axisDays(31).length);
});

test('ogni colonna porta il segno di selezione: trattino e numero acceso', () => {
  const svg = dailyBarsSVG(perDay(31, { 3: 12000 }));
  assert.equal(count(svg, 'class="tick"'), 31);
  assert.equal(count(svg, 'class="lbl-sel"'), 31);
});

test('ogni colonna dichiara giorno e importo (title accessibile)', () => {
  const svg = dailyBarsSVG(perDay(31, { 3: 12000 }));
  assert.ok(svg.includes('<title>3: 120,00 €</title>'));
  assert.ok(svg.includes('<title>4: nessun incasso</title>'));
});

test('mese vuoto: nessuna barra, nessun NaN', () => {
  const svg = dailyBarsSVG(perDay(30));
  assert.equal(count(svg, 'class="bar"'), 0);
  assert.ok(!svg.includes('NaN'));
});

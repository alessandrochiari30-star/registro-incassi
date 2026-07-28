import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount } from '../js/parser.js';

test('interi semplici', () => {
  assert.equal(parseAmount('45'), 4500);
  assert.equal(parseAmount('1'), 100);
});

test('decimali con virgola', () => {
  assert.equal(parseAmount('45,5'), 4550);
  assert.equal(parseAmount('45,50'), 4550);
  assert.equal(parseAmount('0,05'), 5);
});

test('decimali con punto', () => {
  assert.equal(parseAmount('45.50'), 4550);
  assert.equal(parseAmount('45.5'), 4550);
});

test('spazi ai bordi tollerati', () => {
  assert.equal(parseAmount(' 45 '), 4500);
});

test('input non validi rifiutati', () => {
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount(','), null);
  assert.equal(parseAmount('.'), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('45,'), null);
  assert.equal(parseAmount('4,5,0'), null);
  assert.equal(parseAmount('45,123'), null);
  assert.equal(parseAmount('-45'), null);
  assert.equal(parseAmount('45B'), null);
});

test('zero non è un incasso', () => {
  assert.equal(parseAmount('0'), null);
  assert.equal(parseAmount('0,00'), null);
});

test('cap a 999.999,99 €', () => {
  assert.equal(parseAmount('999999,99'), 99999999);
  assert.equal(parseAmount('1000000'), null);
});

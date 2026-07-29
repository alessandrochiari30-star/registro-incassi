import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exportReminder, EXPORT_REMINDER_MS, MSG_NO_PERSISTENCE, MSG_STALE_EXPORT,
} from '../js/reminder.js';

const ORA = Date.parse('2026-07-29T10:00:00');

test('senza dati non si ricorda niente', () => {
  assert.equal(exportReminder({ hasData: false, persisted: false, now: ORA }).visible, false);
  assert.equal(exportReminder().visible, false);
});

test('memoria non garantita: avviso subito, non fra sette giorni', () => {
  // È il caso iPhone: app aperta come scheda Safari, dati sacrificabili.
  const r = exportReminder({ hasData: true, persisted: false, lastExportAt: ORA, now: ORA });
  assert.equal(r.visible, true);
  assert.equal(r.reason, 'memoria');
  assert.equal(r.text, MSG_NO_PERSISTENCE);
});

test('memoria garantita ed export fresco: silenzio', () => {
  const r = exportReminder({ hasData: true, persisted: true, lastExportAt: ORA - 1000, now: ORA });
  assert.equal(r.visible, false);
});

test('export vecchio: avviso con le sue parole', () => {
  const r = exportReminder({
    hasData: true, persisted: true, lastExportAt: ORA - EXPORT_REMINDER_MS - 1, now: ORA,
  });
  assert.equal(r.visible, true);
  assert.equal(r.reason, 'vecchio');
  assert.equal(r.text, MSG_STALE_EXPORT);
});

test('al limite dei sette giorni non parte ancora', () => {
  const r = exportReminder({
    hasData: true, persisted: true, lastExportAt: ORA - EXPORT_REMINDER_MS, now: ORA,
  });
  assert.equal(r.visible, false);
});

test('senza data di riferimento si parte da adesso, non dal 1970', () => {
  // localStorage vietato: non deve tradursi in "export vecchissimo".
  assert.equal(exportReminder({ hasData: true, lastExportAt: null, now: ORA }).visible, false);
  assert.equal(exportReminder({ hasData: true, lastExportAt: NaN, now: ORA }).visible, false);
});

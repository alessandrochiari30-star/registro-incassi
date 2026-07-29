import test from 'node:test';
import assert from 'node:assert/strict';
import { isMirrorError, isPrimaryError, isSaved, writeMessage } from '../js/db.js';
import { MSG_SAVE_FAILED, MSG_MIRROR_FAILED, MSG_PRIMARY_FAILED } from '../js/channels.js';

const named = (name) => {
  const e = new Error('x');
  e.name = name;
  return e;
};

test('i tre esiti di una scrittura non si confondono', () => {
  assert.equal(isMirrorError(named('MirrorError')), true);
  assert.equal(isPrimaryError(named('PrimaryError')), true);
  assert.equal(isMirrorError(named('PrimaryError')), false);
  assert.equal(isPrimaryError(named('MirrorError')), false);
  assert.equal(isMirrorError(new Error('read-back non corrisponde')), false);
  assert.equal(isMirrorError(null), false);
  assert.equal(isPrimaryError(undefined), false);
});

test('isSaved: il dato è sul telefono se ha retto almeno un archivio', () => {
  // La domanda che decide se una riga si toglie dalla memoria: dirla
  // sbagliata significa cancellare qualcosa che era stato salvato.
  assert.equal(isSaved(named('MirrorError')), true);
  assert.equal(isSaved(named('PrimaryError')), true);
  assert.equal(isSaved(new Error('read-back non corrisponde')), false);
  assert.equal(isSaved(null), false);
});

test('ogni esito ha le sue parole', () => {
  assert.equal(writeMessage(named('MirrorError')), MSG_MIRROR_FAILED);
  assert.equal(writeMessage(named('PrimaryError')), MSG_PRIMARY_FAILED);
  assert.equal(writeMessage(new Error('boh')), MSG_SAVE_FAILED);
  assert.equal(writeMessage(null), MSG_SAVE_FAILED);
});

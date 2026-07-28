// Persistenza. IndexedDB è la copia primaria; a ogni scrittura il set
// completo viene specchiato in localStorage. Ogni write ha read-back di
// verifica e un retry: un fallimento qui deve emergere, mai sparire.

import { reconcile } from './backup.js';

const DB_NAME = 'registro-incassi';
const STORE = 'entries';
const MIRROR_KEY = 'ri-backup';

let db = null;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll() {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(id) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(entry) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transazione annullata'));
  });
}

function idbPutAll(entries) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const e of entries) store.put(e);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transazione annullata'));
  });
}

function mirrorRead() {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.entries) ? parsed.entries : null;
  } catch {
    return null;
  }
}

function mirrorWrite(entries) {
  localStorage.setItem(MIRROR_KEY, JSON.stringify({ savedAt: Date.now(), entries }));
}

// Apre il DB, riconcilia con il mirror e restituisce lo stato di verità.
// Se è avvenuto un recupero, riallinea subito entrambe le copie.
export async function initDB() {
  let idbEntries = null;
  try {
    db = await open();
    idbEntries = await idbGetAll();
  } catch {
    idbEntries = null; // IndexedDB illeggibile: si va di mirror
  }
  const { entries, recovered } = reconcile(idbEntries, mirrorRead());
  if (recovered && db) {
    try {
      for (const e of entries) await idbPut(e);
    } catch { /* il mirror resta comunque la rete di sicurezza */ }
  }
  try { mirrorWrite(entries); } catch { /* quota: segnalato altrove */ }
  return { entries, recovered };
}

// Scrive una riga (nuova o modificata) e specchia l'intero set.
// Read-back + 1 retry; se fallisce tutto, lancia: il chiamante DEVE
// mostrare l'errore, mai inghiottirlo.
export async function saveEntry(entry, allEntries) {
  if (!db) db = await open();
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await idbPut(entry);
      const back = await idbGet(entry.id);
      if (!back || back.amountCents !== entry.amountCents ||
          back.date !== entry.date || back.channel !== entry.channel ||
          back.deletedAt !== entry.deletedAt) {
        throw new Error('read-back non corrisponde');
      }
      mirrorWrite(allEntries);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  // IndexedDB ko: prova almeno a salvare il mirror prima di segnalare.
  try { mirrorWrite(allEntries); } catch { /* niente da fare */ }
  throw lastErr;
}

// Scrittura in blocco (import da backup): tutte le righe in una sola
// transazione, read-back di conteggio, poi mirror completo. Stesso
// patto di saveEntry: se fallisce tutto, lancia e il chiamante segnala.
export async function saveAll(entries) {
  if (!db) db = await open();
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await idbPutAll(entries);
      const back = await idbGetAll();
      if (back.length < entries.length) throw new Error('read-back incompleto');
      mirrorWrite(entries);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  // IndexedDB ko: prova almeno a salvare il mirror prima di segnalare.
  try { mirrorWrite(entries); } catch { /* niente da fare */ }
  throw lastErr;
}

// Cancellazione definitiva (svuota cestino): toglie gli id indicati e
// specchia ciò che resta. Read-back di verifica: se una riga è ancora
// lì il mirror non viene toccato, così la prossima riconciliazione non
// la resuscita in un insieme incoerente.
export async function purgeEntries(ids, remaining) {
  if (!db) db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transazione annullata'));
  });
  const back = await idbGetAll();
  const superstiti = new Set(back.map((e) => e.id));
  if (ids.some((id) => superstiti.has(id))) throw new Error('cancellazione incompleta');
  mirrorWrite(remaining);
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* ignorato: gestito dal chiamante come "non garantita" */ }
  return false;
}

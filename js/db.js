// Persistenza. IndexedDB è la copia primaria; a ogni scrittura il set
// completo viene specchiato in localStorage. Ogni write ha read-back di
// verifica e un retry: un fallimento qui deve emergere, mai sparire.
//
// Due archivi con le stesse regole: 'entries' (gli incassi) e 'extras'
// (le uscite, fisse e variabili). Stesso patto, stesso mirror.

import { reconcile } from './backup.js';

const DB_NAME = 'registro-incassi';
const DB_VERSION = 2; // v2: aggiunto lo store 'extras'
const STORE = 'entries';
const STORE_X = 'extras';
const MIRROR_KEY = 'ri-backup';
const MIRROR_KEY_X = 'ri-extras';

let db = null;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // Creazione difensiva: l'upgrade parte sia da database nuovo sia da
    // uno già pieno alla v1, e non deve mai toccare i dati esistenti.
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(STORE_X)) d.createObjectStore(STORE_X, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(store = STORE) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(id, store = STORE) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(entry, store = STORE) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transazione annullata'));
  });
}

function idbPutAll(entries, store = STORE) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const e of entries) os.put(e);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transazione annullata'));
  });
}

function mirrorRead(key = MIRROR_KEY) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.entries) ? parsed.entries : null;
  } catch {
    return null;
  }
}

function mirrorWrite(entries, key = MIRROR_KEY) {
  localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), entries }));
}

// Apre il DB, riconcilia entrambi gli archivi col mirror e restituisce
// lo stato di verità. Se è avvenuto un recupero, riallinea subito le
// copie.
export async function initDB() {
  let idbEntries = null;
  let idbExtras = null;
  try {
    db = await open();
    idbEntries = await idbGetAll(STORE);
    idbExtras = await idbGetAll(STORE_X);
  } catch {
    idbEntries = idbEntries ?? null; // IndexedDB illeggibile: si va di mirror
    idbExtras = idbExtras ?? null;
  }
  const rec = reconcile(idbEntries, mirrorRead(MIRROR_KEY));
  const recX = reconcile(idbExtras, mirrorRead(MIRROR_KEY_X));
  if (db) {
    try {
      if (rec.recovered) for (const e of rec.entries) await idbPut(e, STORE);
      if (recX.recovered) for (const x of recX.entries) await idbPut(x, STORE_X);
    } catch { /* il mirror resta comunque la rete di sicurezza */ }
  }
  try {
    mirrorWrite(rec.entries, MIRROR_KEY);
    mirrorWrite(recX.entries, MIRROR_KEY_X);
  } catch { /* quota: segnalato altrove */ }
  return { entries: rec.entries, extras: recX.entries, recovered: rec.recovered || recX.recovered };
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

// Stesso patto di saveEntry, per le uscite. Il read-back confronta i
// campi che contano: importo, voce, data, cancellazione.
export async function saveExtra(extra, allExtras) {
  if (!db) db = await open();
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await idbPut(extra, STORE_X);
      const back = await idbGet(extra.id, STORE_X);
      if (!back || back.amountCents !== extra.amountCents ||
          back.label !== extra.label || back.date !== extra.date ||
          back.deletedAt !== extra.deletedAt) {
        throw new Error('read-back non corrisponde');
      }
      mirrorWrite(allExtras, MIRROR_KEY_X);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  try { mirrorWrite(allExtras, MIRROR_KEY_X); } catch { /* niente da fare */ }
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

// Scrittura in blocco delle uscite (import da backup, o creazione
// delle voci fisse di partenza).
export async function saveAllExtras(extras) {
  if (!db) db = await open();
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await idbPutAll(extras, STORE_X);
      const back = await idbGetAll(STORE_X);
      if (back.length < extras.length) throw new Error('read-back incompleto');
      mirrorWrite(extras, MIRROR_KEY_X);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  try { mirrorWrite(extras, MIRROR_KEY_X); } catch { /* niente da fare */ }
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

// Azzeramento totale: incassi E uscite. Ordine obbligato: prima
// IndexedDB, poi il read-back, e SOLO se il read-back dice zero si
// tolgono i mirror. Se qualcosa va storto i mirror restano e alla
// riapertura la riconciliazione rimette tutto al suo posto: meglio
// dati che tornano di dati persi a metà.
export async function wipeAll() {
  if (!db) db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, STORE_X], 'readwrite');
    tx.objectStore(STORE).clear();
    tx.objectStore(STORE_X).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transazione annullata'));
  });
  const back = await idbGetAll();
  const backX = await idbGetAll(STORE_X);
  if (back.length > 0 || backX.length > 0) throw new Error('azzeramento incompleto');
  localStorage.removeItem(MIRROR_KEY);
  localStorage.removeItem(MIRROR_KEY_X);
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* ignorato: gestito dal chiamante come "non garantita" */ }
  return false;
}

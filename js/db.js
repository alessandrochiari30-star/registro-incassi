// Persistenza. IndexedDB è la copia primaria; a ogni scrittura il set
// completo viene specchiato in localStorage. Ogni scrittura ha
// read-back di verifica e un retry: un fallimento qui deve emergere,
// mai sparire.
//
// Due archivi con le stesse regole: 'entries' (gli incassi) e 'extras'
// (le uscite, fisse e variabili).
//
// Il mirror è la rete di sicurezza, non la copia primaria: se salta
// solo lui il dato è comunque salvato, e chi chiama riceve un errore
// con name 'MirrorError' per dirlo con parole diverse. Confondere i
// due casi faceva comparire "salvataggio non riuscito" su dati
// perfettamente salvati.

import { reconcile } from './backup.js';
import { MSG_SAVE_FAILED, MSG_MIRROR_FAILED, MSG_PRIMARY_FAILED } from './channels.js';

const DB_NAME = 'registro-incassi';
const DB_VERSION = 2; // v2: aggiunto lo store 'extras'
const STORE = 'entries';
const STORE_X = 'extras';
const MIRROR_KEY = 'ri-backup';
const MIRROR_KEY_X = 'ri-extras';

let db = null;

function mirrorError(cause) {
  const err = new Error('mirror non scritto');
  err.name = 'MirrorError';
  err.cause = cause;
  return err;
}

// L'archivio primario ha rifiutato la scrittura ma la copia di
// sicurezza l'ha presa: il dato esiste, su una gamba sola.
function primaryError(cause) {
  const err = new Error('archivio primario non scritto');
  err.name = 'PrimaryError';
  err.cause = cause;
  return err;
}

// Distinguere i guai è la regola più importante di questo file, e prima
// era ricopiata a mano in otto punti diversi: in due era stata
// dimenticata, e lì un salvataggio riuscito veniva trattato come
// fallito. Si chiede qui, in un posto solo.
export function isMirrorError(err) {
  return err?.name === 'MirrorError';
}

export function isPrimaryError(err) {
  return err?.name === 'PrimaryError';
}

// La domanda che conta per chi ha appena scritto: il dato è da qualche
// parte su questo telefono? Se sì il gesto va portato a termine e la
// riga NON va tolta dalla memoria, altrimenti si cancellerebbe qualcosa
// che è stato salvato.
export function isSaved(err) {
  return isMirrorError(err) || isPrimaryError(err);
}

export function writeMessage(err) {
  if (isMirrorError(err)) return MSG_MIRROR_FAILED;
  if (isPrimaryError(err)) return MSG_PRIMARY_FAILED;
  return MSG_SAVE_FAILED;
}

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
    // Un'altra scheda aperta sulla versione vecchia blocca l'upgrade:
    // senza questo la promise non si risolverebbe mai e l'app
    // resterebbe appesa senza dire niente.
    req.onblocked = () => reject(new Error('aggiornamento bloccato da un\'altra scheda aperta'));
    req.onsuccess = () => {
      const d = req.result;
      // Se un'altra scheda chiede un upgrade, questa connessione si
      // toglie di mezzo invece di bloccarla.
      d.onversionchange = () => { d.close(); db = null; };
      resolve(d);
    };
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

// Scrittura su IndexedDB con read-back e un retry, poi mirror. Il
// mirror sta FUORI dal ciclo dei tentativi: se lancia lui, il dato è
// già al sicuro nell'archivio primario e non ha senso riprovare la
// scrittura né dire che il salvataggio è fallito.
async function writeWithRetry(attempt) {
  let lastErr = null;
  for (let i = 0; i < 2; i++) {
    try {
      await attempt();
      return null;
    } catch (err) {
      lastErr = err;
    }
  }
  return lastErr;
}

// Apre il DB, riconcilia entrambi gli archivi col mirror e restituisce
// lo stato di verità. `idbDown` dice che l'archivio primario non si è
// aperto: si sta lavorando sul solo mirror, e chi chiama deve dirlo.
export async function initDB() {
  let idbEntries = null;
  let idbExtras = null;
  let idbDown = false;
  try {
    db = await open();
    idbEntries = await idbGetAll(STORE);
    idbExtras = await idbGetAll(STORE_X);
  } catch {
    idbDown = true; // IndexedDB illeggibile: si va di mirror
  }
  const rec = reconcile(idbEntries, mirrorRead(MIRROR_KEY));
  const recX = reconcile(idbExtras, mirrorRead(MIRROR_KEY_X));
  if (db) {
    try {
      if (rec.recovered) for (const e of rec.entries) await idbPut(e, STORE);
      if (recX.recovered) for (const x of recX.entries) await idbPut(x, STORE_X);
    } catch { /* il mirror resta comunque la rete di sicurezza */ }
  }
  let mirrorDown = false;
  try {
    mirrorWrite(rec.entries, MIRROR_KEY);
    mirrorWrite(recX.entries, MIRROR_KEY_X);
  } catch {
    mirrorDown = true; // niente rete di sicurezza: va detto, non taciuto
  }
  return {
    entries: rec.entries,
    extras: recX.entries,
    recovered: rec.recovered || recX.recovered,
    idbDown,
    mirrorDown,
  };
}

// Scrive una riga (nuova o modificata) e specchia l'intero set.
// Se fallisce IndexedDB lancia l'errore vero; se fallisce solo il
// mirror lancia un MirrorError, che è un guaio diverso e più mite.
export async function saveEntry(entry, allEntries) {
  if (!db) db = await open();
  const err = await writeWithRetry(async () => {
    await idbPut(entry);
    const back = await idbGet(entry.id);
    if (!back || back.amountCents !== entry.amountCents ||
        back.date !== entry.date || back.channel !== entry.channel ||
        back.deletedAt !== entry.deletedAt) {
      throw new Error('read-back non corrisponde');
    }
  });
  if (err) {
    // IndexedDB ko: la copia di sicurezza diventa l'unico posto dove il
    // dato può stare, quindi ci si scrive l'insieme completo. Se ci
    // riesce il dato NON è perduto e chi ha chiamato deve saperlo con
    // un errore diverso: trattarlo come fallimento totale gli faceva
    // togliere dalla memoria una riga che il mirror aveva salvato, e
    // che alla riapertura tornava su da sola.
    try { mirrorWrite(allEntries); } catch { throw err; }
    throw primaryError(err);
  }
  try { mirrorWrite(allEntries); } catch (e) { throw mirrorError(e); }
}

// Stesso patto di saveEntry, per le uscite. Il read-back confronta i
// campi che contano: importo, voce, data, cancellazione.
export async function saveExtra(extra, allExtras) {
  if (!db) db = await open();
  const err = await writeWithRetry(async () => {
    await idbPut(extra, STORE_X);
    const back = await idbGet(extra.id, STORE_X);
    if (!back || back.amountCents !== extra.amountCents ||
        back.label !== extra.label || back.date !== extra.date ||
        back.deletedAt !== extra.deletedAt) {
      throw new Error('read-back non corrisponde');
    }
  });
  if (err) {
    try { mirrorWrite(allExtras, MIRROR_KEY_X); } catch { throw err; }
    throw primaryError(err);
  }
  try { mirrorWrite(allExtras, MIRROR_KEY_X); } catch (e) { throw mirrorError(e); }
}

// Read-back di un blocco: non basta contare le righe, servono proprio
// gli id che si sono appena scritti. Su un ripristino da backup è la
// verifica che conta.
function missingIds(written, back) {
  const presenti = new Set(back.map((e) => e.id));
  return written.filter((e) => !presenti.has(e.id)).length;
}

// Scrittura in blocco (import da backup): tutte le righe in una sola
// transazione, read-back per id, poi mirror completo.
export async function saveAll(entries) {
  if (!db) db = await open();
  const err = await writeWithRetry(async () => {
    await idbPutAll(entries);
    const back = await idbGetAll();
    if (missingIds(entries, back) > 0) throw new Error('read-back incompleto');
  });
  if (err) {
    try { mirrorWrite(entries); } catch { throw err; }
    throw primaryError(err);
  }
  try { mirrorWrite(entries); } catch (e) { throw mirrorError(e); }
}

// Scrittura in blocco delle uscite (import da backup).
export async function saveAllExtras(extras) {
  if (!db) db = await open();
  const err = await writeWithRetry(async () => {
    await idbPutAll(extras, STORE_X);
    const back = await idbGetAll(STORE_X);
    if (missingIds(extras, back) > 0) throw new Error('read-back incompleto');
  });
  if (err) {
    try { mirrorWrite(extras, MIRROR_KEY_X); } catch { throw err; }
    throw primaryError(err);
  }
  try { mirrorWrite(extras, MIRROR_KEY_X); } catch (e) { throw mirrorError(e); }
}

// Cancellazione definitiva (svuota cestino): toglie gli id indicati dai
// due archivi e specchia ciò che resta. Read-back di verifica: se una
// riga è ancora lì i mirror non vengono toccati, così la prossima
// riconciliazione non la resuscita in un insieme incoerente.
export async function purgeAll({ entryIds = [], extraIds = [], remainingEntries, remainingExtras }) {
  if (!db) db = await open();
  const err = await writeWithRetry(async () => {
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE, STORE_X], 'readwrite');
      for (const id of entryIds) tx.objectStore(STORE).delete(id);
      for (const id of extraIds) tx.objectStore(STORE_X).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('transazione annullata'));
    });
    const back = new Set((await idbGetAll()).map((e) => e.id));
    const backX = new Set((await idbGetAll(STORE_X)).map((e) => e.id));
    if (entryIds.some((id) => back.has(id)) || extraIds.some((id) => backX.has(id))) {
      throw new Error('cancellazione incompleta');
    }
  });
  if (err) throw err;
  try {
    mirrorWrite(remainingEntries);
    mirrorWrite(remainingExtras, MIRROR_KEY_X);
  } catch (e) {
    throw mirrorError(e);
  }
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

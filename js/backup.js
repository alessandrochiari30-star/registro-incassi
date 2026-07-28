// Riconciliazione fra IndexedDB (primario) e mirror localStorage,
// e logica pura dell'import da file di backup JSON.
// Regola di sicurezza: il risultato non è mai più piccolo della copia
// più grande — mai sovrascrivere dati con un insieme ridotto.

export function reconcile(idbEntries, mirrorEntries) {
  const idb = idbEntries ?? [];
  const mirror = mirrorEntries ?? [];

  if (idb.length === 0 && mirror.length === 0) return { entries: [], source: 'idb', recovered: false };
  if (idb.length === 0) return { entries: mirror, source: 'mirror', recovered: true };
  if (mirror.length === 0) return { entries: idb, source: 'idb', recovered: false };

  const byId = new Map();
  for (const e of mirror) byId.set(e.id, e);
  for (const e of idb) byId.set(e.id, e); // in conflitto vince idb
  const entries = [...byId.values()];

  if (entries.length === idb.length) return { entries: idb, source: 'idb', recovered: false };
  return { entries, source: 'union', recovered: true };
}

// ---------- import da file di backup ----------

// Mese 01-12, giorno 01-31: basta a scartare date impossibili senza
// dipendere dal fuso o dal calendario.
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isValidEntry(e) {
  return e !== null && typeof e === 'object'
    && typeof e.id === 'string' && e.id.length > 0
    && typeof e.date === 'string' && DATE_RE.test(e.date)
    && Number.isInteger(e.amountCents) && e.amountCents >= 0
    && ['B', 'S', 'R', 'C'].includes(e.channel)
    && typeof e.createdAt === 'number' && Number.isFinite(e.createdAt)
    && (e.deletedAt === null
      || (typeof e.deletedAt === 'number' && Number.isFinite(e.deletedAt)));
}

// Legge il testo di un file di backup e valida tutto.
// Politica: se anche UNA riga è rotta si rifiuta l'intero file.
// I backup li genera solo quest'app, quindi una riga rotta significa
// file danneggiato o manomesso: meglio un rifiuto spiegato che un
// import parziale silenzioso su cui l'utente farebbe affidamento.
// Ritorna { ok:true, entries } oppure { ok:false, error, badRows? }
// con error in: 'json' (illeggibile), 'formato' (non è un nostro
// backup), 'righe' (righe danneggiate).
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'json' };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)
    || typeof data.exportedAt !== 'string' || !Array.isArray(data.entries)) {
    return { ok: false, error: 'formato' };
  }
  const badRows = data.entries.filter((e) => !isValidEntry(e)).length;
  if (badRows > 0) return { ok: false, error: 'righe', badRows };
  return { ok: true, entries: data.entries };
}

// Fonde le righe importate con quelle presenti: unione per id, il
// risultato non è mai più piccolo dell'insieme locale. In conflitto
// vince la riga locale: il backup è per forza più vecchio (o uguale),
// quindi modifiche e cestinature fatte dopo il backup non si perdono.
// Ritorna { entries, added, existing }.
export function mergeBackup(currentEntries, importedEntries) {
  const current = currentEntries ?? [];
  const byId = new Map();
  for (const e of importedEntries) byId.set(e.id, e); // dedup interno al file
  const importedIds = new Set(byId.keys());
  for (const e of current) byId.set(e.id, e); // in conflitto vince il locale
  let existing = 0;
  for (const e of current) if (importedIds.has(e.id)) existing++;
  const entries = [...byId.values()];
  return { entries, added: entries.length - current.length, existing };
}

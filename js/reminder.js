// Quando ricordare l'export, e con che parole. Logica pura: l'unico
// posto dove si decide se il promemoria si vede.
//
// Due motivi diversi, non uno solo:
//  - la memoria del browser non è garantita (iOS in scheda Safari,
//    navigazione privata): il rischio è oggi, non fra una settimana;
//  - è passato troppo tempo dall'ultimo export.
// Prima il primo caso veniva acceso e subito spento dal secondo, che
// per i primi sette giorni dice sempre di no: l'avviso non compariva
// mai proprio quando serviva.

export const EXPORT_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

export const MSG_NO_PERSISTENCE =
  'Questo browser non garantisce la memoria: i dati possono sparire da soli. Fai un export e tienilo da parte.';
export const MSG_STALE_EXPORT =
  'È da un po\' che non fai un export: i dati vivono solo su questo telefono.';

// Ritorna { visible, reason, text }. reason: 'memoria' | 'vecchio' | null.
export function exportReminder({
  hasData = false,
  persisted = true,
  lastExportAt = null,
  now = Date.now(),
} = {}) {
  if (!hasData) return { visible: false, reason: null, text: '' };
  // La memoria a rischio viene prima: è il guaio più grave dei due.
  if (!persisted) return { visible: true, reason: 'memoria', text: MSG_NO_PERSISTENCE };
  // Attenzione: Number(null) fa 0, cioè il 1970 — senza questo, "non lo
  // so" diventava "export vecchio di cinquant'anni".
  const last = lastExportAt === null || lastExportAt === undefined ? NaN : Number(lastExportAt);
  const riferimento = Number.isFinite(last) ? last : now;
  if (now - riferimento > EXPORT_REMINDER_MS) {
    return { visible: true, reason: 'vecchio', text: MSG_STALE_EXPORT };
  }
  return { visible: false, reason: null, text: '' };
}

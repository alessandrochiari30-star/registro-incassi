// Logica del tasto "azzera tutti i dati", tenuta fuori dal DOM perché
// è l'unica funzione dell'app che autorizza una distruzione totale, e
// deve essere leggibile e testabile da sola.
//
// Tre lucchetti in fila, nessuno saltabile: righe da cancellare,
// backup fatto in questa sessione, parola scritta a mano. Poi il
// bottone chiede ancora una conferma (quella la gestisce chi disegna).

export const RESET_PHRASE = 'AZZERA';

export function normalizePhrase(text) {
  return String(text ?? '').trim().toUpperCase();
}

// Ritorna { enabled, reason }: reason dice quale lucchetto è ancora
// chiuso, così l'interfaccia può spiegarlo invece di limitarsi a
// mostrare un bottone spento.
export function resetGate({ backupDone = false, phrase = '', rowCount = 0 } = {}) {
  if (!(rowCount > 0)) return { enabled: false, reason: 'vuoto' };
  if (!backupDone) return { enabled: false, reason: 'backup' };
  if (normalizePhrase(phrase) !== RESET_PHRASE) return { enabled: false, reason: 'parola' };
  return { enabled: true, reason: null };
}

export function gateHint(reason) {
  switch (reason) {
    case 'vuoto': return 'Non c\'è niente da cancellare.';
    case 'backup': return 'Prima fai il backup: senza, il tasto resta spento.';
    case 'parola': return `Scrivi ${RESET_PHRASE} per sbloccare il tasto.`;
    default: return 'Tasto sbloccato: il prossimo tocco chiede conferma.';
  }
}

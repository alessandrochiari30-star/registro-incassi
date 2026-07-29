// Costanti condivise da più schermate. Stanno qui e in nessun altro
// posto: prima i canali e le soglie erano riscritti in ogni file e lo
// stesso canale aveva tre nomi diversi in tre schermate.

export const CHANNELS = ['B', 'S', 'R', 'C'];

// Nomi lunghi (toast, legende) e corti (righe fitte).
export const CH_NAMES = {
  B: 'Bancomat',
  S: 'Satispay',
  R: 'Contante con ricevuta',
  C: 'Cash',
};
export const CH_SHORT = { B: 'bancomat', S: 'satispay', R: 'ricevuta', C: 'cash' };

// Canali che finiscono nel dichiarato: tutto tranne il contante senza
// ricevuta.
export const DECLARED_CHANNELS = ['B', 'S', 'R'];

// Soglia del forfettario: 85.000 € l'anno.
export const THRESHOLD_CENTS = 8_500_000;

// Minimale INPS commercianti 2026: sotto questi ricavi i contributi
// restano quelli fissi, sopra si paga la quota eccedente. È molto più
// vicino della soglia del forfettario, quindi va segnato sulla stessa
// barra. Numero del dossier 2026: ricontrollarlo ogni anno.
export const INPS_MIN_CENTS = 2_807_200;

// Soglia oltre la quale una visita è un lavoro prenotato e non un
// passaggio veloce. Taglio scelto sui numeri del dossier 2025: la
// visita media pagata in elettronico stava a 76,82 €, quella in
// contante a 24,29 €, e 50 € cade nel vuoto fra le due.
export const BIG_VISIT_CENTS = 5_000;

export const MSG_SAVE_FAILED =
  'ATTENZIONE: salvataggio non riuscito. Non chiudere l\'app e fai subito un export dei dati.';

// Il dato è salvato, manca solo la copia di sicurezza: guaio vero ma
// molto meno grave, e con parole diverse.
export const MSG_MIRROR_FAILED =
  'Copia di sicurezza non aggiornata: i dati sono salvati, ma conviene fare un export.';

// Il contrario: l'archivio principale non ha accettato la scrittura ma
// la copia di sicurezza sì. Il dato c'è, l'app regge, però sta in piedi
// su una gamba sola.
export const MSG_PRIMARY_FAILED =
  'Archivio principale non disponibile: i dati sono al sicuro nella copia, ma fai un export appena puoi.';

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

export const MSG_SAVE_FAILED =
  'ATTENZIONE: salvataggio non riuscito. Non chiudere l\'app e fai subito un export dei dati.';

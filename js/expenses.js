// Uscite: le fisse (si ripetono ogni mese) e le variabili (una data,
// una voce, es. "40 shopping"). Logica pura, niente DOM e niente
// database: qui dentro si decide solo quanto resta in tasca.
//
// Regola di lettura: gli incassi sono lordi di tutto. Il netto che
// questa app mostra è "quanto resta dopo le uscite che Paola ha
// scritto qui", non un utile fiscale.

import { parseAmount } from './parser.js';

// Due voci fisse, modificabili: servono a dare un riferimento al
// pareggio, non a fare il budget. La prima parte dai costi di attività
// misurati nel dossier 2025 (affitto, utenze, contributi,
// commercialista), la seconda è quello che la casa chiede ogni mese —
// perché la giornata di lavoro deve coprire tutte e due. Un numero di
// un anno fa non deve sopravvivere per inerzia, quindi si cambiano con
// un tocco.
export const FIXED_ID = 'fixed-monthly';
export const DEFAULT_FIXED_CENTS = 135_036;
export const DEFAULT_FIXED_LABEL = 'Spese attività';

export const FIXED_HOME_ID = 'fixed-home';
export const DEFAULT_HOME_CENTS = 90_000;
export const DEFAULT_HOME_LABEL = 'Spese casa';

export const FIXED_ITEMS = [
  { id: FIXED_ID, label: DEFAULT_FIXED_LABEL, defaultCents: DEFAULT_FIXED_CENTS },
  { id: FIXED_HOME_ID, label: DEFAULT_HOME_LABEL, defaultCents: DEFAULT_HOME_CENTS },
];

export const DEFAULT_EXPENSE_LABEL = 'spesa';
export const MAX_LABEL = 40;

// "40 shopping", "12,50 benzina", "spesa 100", "40". L'importo può
// stare davanti o in fondo: si scrive di corsa, non si compila un
// modulo. Ritorna null se non c'è un importo valido.
export function parseExpenseInput(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;

  const head = /^([\d.,]+)\s*(.*)$/.exec(s);
  const tail = /^(.*?)\s*([\d.,]+)$/.exec(s);
  for (const [amountStr, labelStr] of [
    head ? [head[1], head[2]] : null,
    tail ? [tail[2], tail[1]] : null,
  ].filter(Boolean)) {
    const amountCents = parseAmount(amountStr);
    if (amountCents === null) continue;
    const label = labelStr.trim().slice(0, MAX_LABEL) || DEFAULT_EXPENSE_LABEL;
    return { amountCents, label };
  }
  return null;
}

const alive = (extras) => (extras ?? []).filter((x) => x.deletedAt == null);

// La riga salvata di una voce fissa, cercata per id. Se non c'è ancora
// (prima apertura, o cancellata) ritorna null e vale il valore di
// partenza — vedi fixedAmount.
export function fixedEntry(extras, id = FIXED_ID) {
  return alive(extras).find((x) => x.kind === 'fixed' && x.id === id) ?? null;
}

export function fixedAmount(extras, id) {
  const saved = fixedEntry(extras, id);
  if (saved) return saved.amountCents;
  return FIXED_ITEMS.find((i) => i.id === id)?.defaultCents ?? 0;
}

export function variableItems(extras, ym) {
  return alive(extras).filter((x) => x.kind === 'var' && x.date?.startsWith(ym + '-'));
}

// Le impreviste: dentiste, gomme, la caldaia. Appartengono al MESE, non
// a un giorno e non alle fisse.
// Perché una terza categoria e non una terza voce fissa: una fissa si
// ripete ogni mese e alza la quota giornaliera per sempre, quindi un
// imprevisto dimenticato lì dentro gonfia l'obiettivo di tutti i mesi
// che vengono. Qui invece agosto riparte pulito, e la quota della
// giornata (che si ricava dalle sole fisse) non si muove.
export const UNEXPECTED_LABEL = 'imprevisto';

// La data serve solo ad ancorare la riga al mese: è il primo del mese
// mostrato, non il giorno della spesa. Non comparendo in nessuna
// schermata di giornata, nessuno la legge come "spesa del 1°".
export const unexpectedDate = (ym) => `${ym}-01`;

export function unexpectedItems(extras, ym) {
  return alive(extras)
    .filter((x) => x.kind === 'unexp' && x.date?.startsWith(ym + '-'))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function unexpectedTotal(extras, ym) {
  return sum(unexpectedItems(extras, ym));
}

export function dayVariableItems(extras, iso) {
  return alive(extras).filter((x) => x.kind === 'var' && x.date === iso);
}

const sum = (items) => items.reduce((s, x) => s + x.amountCents, 0);

export function fixedTotal(extras) {
  return FIXED_ITEMS.reduce((s, i) => s + fixedAmount(extras, i.id), 0);
}

export function variableTotal(extras, ym) {
  return sum(variableItems(extras, ym));
}

// Giornate di lavoro del mese. Paola apre dal lunedì al sabato, ma il
// sabato è solo la mattina: vale mezza giornata, così la settimana fa
// 5,5. La domenica è chiusa e non conta.
// Il divisore è questo, NON i giorni di calendario: la domanda che si
// fa la sera è "quanto deve rendere una giornata di lavoro", e su
// quella riga la domenica non c'è.
export function workDaysInMonth(ym) {
  const [y, m] = String(ym ?? '').split('-').map(Number);
  if (!(y > 0) || !(m >= 1 && m <= 12)) return 0;
  const last = new Date(y, m, 0).getDate();
  let n = 0;
  for (let d = 1; d <= last; d++) {
    const wd = new Date(y, m - 1, d).getDay(); // 0 domenica, 6 sabato
    if (wd === 0) continue;
    n += wd === 6 ? 0.5 : 1;
  }
  return n;
}

export function isOpenDay(iso) {
  const [y, m, d] = String(iso ?? '').split('-').map(Number);
  if (!(y > 0)) return false;
  return new Date(y, m - 1, d).getDay() !== 0;
}

// Quota di fisse che una giornata deve coprire: serve a vedere ogni
// sera se la giornata ha pagato la sua parte di affitto, non solo se ha
// incassato.
export function dailyFixedShare(fixedCents, workDays) {
  if (!(workDays > 0)) return 0;
  return Math.round(fixedCents / workDays);
}

// La quota del singolo giorno: uguale in tutti i giorni di apertura,
// zero di domenica. Sommando i giorni aperti si supera di poco il
// totale delle fisse (il sabato paga come un feriale pur contando
// mezzo): l'obiettivo giornaliero resta un filo prudente, mai basso.
export function dayFixedShare(fixedCents, iso) {
  if (!isOpenDay(iso)) return 0;
  return dailyFixedShare(fixedCents, workDaysInMonth(String(iso).slice(0, 7)));
}

// Conto della singola giornata.
export function dayBalance({ incomeCents = 0, variableCents = 0, fixedShareCents = 0 } = {}) {
  const outflow = variableCents + fixedShareCents;
  return { incomeCents, outflow, netCents: incomeCents - outflow };
}

// Conto del mese intero. Le impreviste entrano nell'uscita del mese
// (e quindi nel netto e nel giorno di pareggio) ma non nella quota
// giornaliera, che si ricava dalle sole fisse.
export function monthBalance({
  incomeCents = 0, fixedCents = 0, variableCents = 0, unexpectedCents = 0,
} = {}) {
  const outflow = fixedCents + variableCents + unexpectedCents;
  return {
    incomeCents, fixedCents, variableCents, unexpectedCents,
    outflow, netCents: incomeCents - outflow,
  };
}

// Il giorno in cui l'incasso cumulato del mese copre tutte le uscite
// del mese. Ritorna { day, missingCents }: se day è null il pareggio
// non è ancora arrivato e missingCents dice quanto manca.
export function breakEvenDay(perDay, outflowCents) {
  let cum = 0;
  for (const d of perDay ?? []) {
    cum += d.total;
    if (outflowCents > 0 && cum >= outflowCents) return { day: d.day, missingCents: 0 };
  }
  if (!(outflowCents > 0)) return { day: null, missingCents: 0 };
  return { day: null, missingCents: outflowCents - cum };
}

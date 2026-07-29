// Uscite: le fisse (si ripetono ogni mese) e le variabili (una data,
// una voce, es. "40 shopping"). Logica pura, niente DOM e niente
// database: qui dentro si decide solo quanto resta in tasca.
//
// Regola di lettura: gli incassi sono lordi di tutto. Il netto che
// questa app mostra è "quanto resta dopo le uscite che Paola ha
// scritto qui", non un utile fiscale.

import { parseAmount } from './parser.js';

// Una sola voce fissa, modificabile: serve a dare un riferimento al
// pareggio, non a fare il budget. Parte dai costi di attività misurati
// nel dossier 2025 (affitto, utenze, contributi, commercialista); un
// numero di un anno fa non deve sopravvivere per inerzia, quindi si
// cambia con un tocco.
export const FIXED_ID = 'fixed-monthly';
export const DEFAULT_FIXED_CENTS = 135_036;
export const DEFAULT_FIXED_LABEL = 'Spese fisse del mese';

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

// La voce fissa è una sola. Se non c'è ancora (prima apertura, o
// cancellata) vale il valore di partenza.
export function fixedEntry(extras) {
  return alive(extras).find((x) => x.kind === 'fixed') ?? null;
}

export function variableItems(extras, ym) {
  return alive(extras).filter((x) => x.kind === 'var' && x.date?.startsWith(ym + '-'));
}

export function dayVariableItems(extras, iso) {
  return alive(extras).filter((x) => x.kind === 'var' && x.date === iso);
}

const sum = (items) => items.reduce((s, x) => s + x.amountCents, 0);

export function fixedTotal(extras) {
  return fixedEntry(extras)?.amountCents ?? DEFAULT_FIXED_CENTS;
}

export function variableTotal(extras, ym) {
  return sum(variableItems(extras, ym));
}

// Quota giornaliera delle spese fisse: servono per vedere ogni sera se
// la giornata ha pagato la sua parte di affitto, non solo se ha
// incassato. Divisione sui giorni di calendario, non sui giorni
// lavorati: l'affitto corre anche di domenica.
export function dailyFixedShare(fixedCents, daysInMonth) {
  if (!(daysInMonth > 0)) return 0;
  return Math.round(fixedCents / daysInMonth);
}

// Conto della singola giornata.
export function dayBalance({ incomeCents = 0, variableCents = 0, fixedShareCents = 0 } = {}) {
  const outflow = variableCents + fixedShareCents;
  return { incomeCents, outflow, netCents: incomeCents - outflow };
}

// Conto del mese intero.
export function monthBalance({ incomeCents = 0, fixedCents = 0, variableCents = 0 } = {}) {
  const outflow = fixedCents + variableCents;
  return { incomeCents, fixedCents, variableCents, outflow, netCents: incomeCents - outflow };
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

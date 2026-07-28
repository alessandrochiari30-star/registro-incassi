// Parser dell'importo: accetta solo "numero" con al massimo due decimali
// (virgola o punto). Restituisce centesimi interi, o null se non valido.
// Rigido per scelta: meglio nessuna riga che una riga sbagliata.

const RE = /^(\d{1,6})(?:[.,](\d{1,2}))?$/;
const MAX_CENTS = 99999999; // 999.999,99 €

export function parseAmount(str) {
  if (typeof str !== 'string') return null;
  const m = RE.exec(str.trim());
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  if (cents === 0 || cents > MAX_CENTS) return null;
  return cents;
}

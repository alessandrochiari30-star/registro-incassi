// Aggregazioni. Regola fissa: i totali si derivano SEMPRE dalle righe,
// mai memorizzati; le righe cancellate (deletedAt != null) non contano mai.

import { CHANNELS, DECLARED_CHANNELS } from './channels.js';
import { daysInMonth } from './money.js';

const ELECTRONIC = new Set(['B', 'S']);
const DECLARED = new Set(DECLARED_CHANNELS);

function alive(entries) {
  return entries.filter((e) => e.deletedAt == null);
}

export function dayTotals(entries, iso) {
  const t = { B: 0, S: 0, R: 0, C: 0, total: 0 };
  for (const e of alive(entries)) {
    if (e.date !== iso) continue;
    t[e.channel] += e.amountCents;
    t.total += e.amountCents;
  }
  return t;
}

export function monthStats(entries, ym) {
  const rows = alive(entries).filter((e) => e.date.startsWith(ym + '-'));
  const byChannel = { B: 0, S: 0, R: 0, C: 0 };
  const byDay = new Map();
  const visitsByDay = new Map();
  let electronicSum = 0, electronicN = 0, cashSum = 0, cashN = 0;

  for (const e of rows) {
    byChannel[e.channel] += e.amountCents;
    byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.amountCents);
    visitsByDay.set(e.date, (visitsByDay.get(e.date) ?? 0) + 1);
    if (ELECTRONIC.has(e.channel)) { electronicSum += e.amountCents; electronicN++; }
    else { cashSum += e.amountCents; cashN++; }
  }

  const total = CHANNELS.reduce((s, c) => s + byChannel[c], 0);
  const visits = rows.length;
  const workedDays = byDay.size;
  const n = daysInMonth(ym);
  // Una casella per ogni giorno del mese, anche i giorni senza incassi:
  // il grafico li mostra tutti e ognuno deve poter rispondere al tocco.
  const perDay = Array.from({ length: n }, (_, i) => {
    const day = i + 1;
    const date = `${ym}-${String(day).padStart(2, '0')}`;
    return { date, day, total: byDay.get(date) ?? 0, visits: visitsByDay.get(date) ?? 0 };
  });

  const div = (a, b) => (b === 0 ? 0 : Math.round(a / b));
  return {
    total, byChannel, perDay, visits, workedDays,
    avgPerWorkedDay: div(total, workedDays),
    avgVisit: div(total, visits),
    avgVisitElectronic: div(electronicSum, electronicN),
    avgVisitCash: div(cashSum, cashN),
  };
}

export function yearDeclared(entries, year) {
  let sum = 0;
  for (const e of alive(entries)) {
    if (DECLARED.has(e.channel) && e.date.startsWith(String(year) + '-')) sum += e.amountCents;
  }
  return sum;
}

// Quanto del mese lo fanno le visite grosse. La clientela è bimodale
// (poche visite grandi, molte piccole): la media da sola la nasconde,
// perché nessuna cliente vale la media.
export function bigVisitShare(entries, ym, thresholdCents) {
  const rows = alive(entries).filter((e) => e.date.startsWith(ym + '-'));
  const total = rows.reduce((s, e) => s + e.amountCents, 0);
  const big = rows.filter((e) => e.amountCents >= thresholdCents);
  const bigTotal = big.reduce((s, e) => s + e.amountCents, 0);
  return {
    visits: rows.length,
    bigVisits: big.length,
    bigTotal,
    total,
    pctVisits: rows.length === 0 ? 0 : Math.round((big.length / rows.length) * 100),
    pctTotal: total === 0 ? 0 : Math.round((bigTotal / total) * 100),
  };
}

export function prevMonthDelta(entries, ym) {
  const [y, m] = ym.split('-').map(Number);
  const prevYm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const prevTotal = monthStats(entries, prevYm).total;
  const curTotal = monthStats(entries, ym).total;
  const deltaPct = prevTotal === 0 ? null : Math.round(((curTotal - prevTotal) / prevTotal) * 100);
  return { prevTotal, deltaPct };
}

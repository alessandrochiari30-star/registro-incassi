// Rendering della schermata registro. Funzioni pure DOM: ricevono lo
// stato, ridisegnano. Nessuno stato proprio oltre il timer del toast.

import { formatCents, todayISO, daysInMonth, monthOf } from './money.js';
import { dayTotals, yearDeclared } from './totals.js';
import { CHANNELS, CH_SHORT, THRESHOLD_CENTS } from './channels.js';
import { dayVariableItems, dailyFixedShare, fixedTotal, dayBalance } from './expenses.js';

const $ = (id) => document.getElementById(id);

export function renderDate(dateISO) {
  const btn = $('btn-date');
  // l'input trasparente sopra il bottone deve già contenere il giorno
  // corrente quando il picker si apre al tocco
  $('date-picker').value = dateISO;
  if (dateISO === todayISO()) {
    btn.textContent = 'oggi';
    btn.classList.remove('not-today');
  } else {
    const [y, m, d] = dateISO.split('-');
    btn.textContent = `${d}/${m}/${y.slice(2)}`;
    btn.classList.add('not-today');
  }
}

const hhmm = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Lista del giorno: incassi e spese insieme, in ordine di inserimento.
// Le spese hanno il badge "−" e l'importo con il segno, così si
// distinguono a colpo d'occhio senza leggere.
export function renderDay(entries, extras, dateISO, onRowTap, onExpenseTap) {
  const t = dayTotals(entries, dateISO);
  for (const ch of CHANNELS) $(`tot-${ch}`).textContent = formatCents(t[ch]);
  $('tot-day').textContent = formatCents(t.total);

  const list = $('day-list');
  list.replaceChildren();
  const rows = entries
    .filter((e) => e.deletedAt == null && e.date === dateISO)
    .map((e) => ({ kind: 'in', e }))
    .concat(dayVariableItems(extras, dateISO).map((x) => ({ kind: 'out', e: x })))
    .sort((a, b) => b.e.createdAt - a.e.createdAt);

  if (rows.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nessun incasso registrato';
    list.append(li);
    return;
  }
  for (const { kind, e } of rows) {
    const li = document.createElement('li');
    const badge = document.createElement('span');
    badge.className = 'badge';
    const amount = document.createElement('span');
    amount.className = 'amount';
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = hhmm(e.createdAt);

    if (kind === 'in') {
      badge.dataset.ch = e.channel;
      badge.textContent = e.channel;
      amount.textContent = formatCents(e.amountCents);
      li.addEventListener('click', () => onRowTap(e.id));
    } else {
      li.classList.add('out');
      badge.dataset.ch = 'X';
      badge.textContent = '−';
      // il segno lo porta già il badge: ripeterlo qui dava "−−40,00 €"
      amount.textContent = `${formatCents(e.amountCents)} · ${e.label}`;
      li.addEventListener('click', () => onExpenseTap(e.id));
    }
    li.append(badge, amount, time);
    list.append(li);
  }
}

// Riga del netto di giornata. Tono neutro per scelta: dice com'è
// andata, non giudica. Il "resta" è già al netto della quota
// giornaliera delle spese fisse.
export function renderDayNet(entries, extras, dateISO) {
  const income = dayTotals(entries, dateISO).total;
  const spese = dayVariableItems(extras, dateISO).reduce((s, x) => s + x.amountCents, 0);
  const quota = dailyFixedShare(fixedTotal(extras), daysInMonth(monthOf(dateISO)));
  const { netCents } = dayBalance({ incomeCents: income, variableCents: spese, fixedShareCents: quota });

  const el = $('day-net');
  el.classList.toggle('positive', netCents > 0);
  const dettaglio = spese > 0
    ? `incassi ${formatCents(income)} − spese ${formatCents(spese)} − quota fissa ${formatCents(quota)}`
    : `incassi ${formatCents(income)} − quota fissa ${formatCents(quota)}`;
  $('day-net-value').textContent = `${netCents >= 0 ? '+' : '−'}${formatCents(Math.abs(netCents))}`;
  $('day-net-detail').textContent = dettaglio;
}

export function renderCounter(entries) {
  const year = Number(todayISO().slice(0, 4));
  const declared = yearDeclared(entries, year);
  $('counter-value').textContent = formatCents(declared);
  const pct = Math.min(100, (declared / THRESHOLD_CENTS) * 100);
  $('counter-fill').style.width = pct.toFixed(1) + '%';
}

export function renderAmount(buffer) {
  $('amount-display').innerHTML = buffer ? '' : '&nbsp;';
  if (buffer) $('amount-display').textContent = buffer + ' €';
}

export function setChannelsEnabled(enabled) {
  for (const b of document.querySelectorAll('#channel-keys button')) b.disabled = !enabled;
}

// Toast unico dell'app. Con onUndo mostra "Annulla"; senza è una
// semplice conferma (o un avviso) che sparisce da sola dopo ms.
let toastTimer = null;
export function showToast(text, onUndo = null, ms = 5000) {
  const toast = $('toast');
  const undo = $('toast-undo');
  $('toast-text').textContent = text;
  undo.hidden = !onUndo;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
  undo.onclick = onUndo
    ? () => {
        clearTimeout(toastTimer);
        toast.hidden = true;
        onUndo();
      }
    : null;
}

export function showBanner(text) {
  const b = $('banner');
  b.textContent = text;
  b.hidden = false;
}

export function showExportReminder(visible) {
  $('export-reminder').hidden = !visible;
}

// Cestino: incassi e spese cancellate insieme. Prima le spese finivano
// in un limbo — cancellate, invisibili, non ripristinabili — e
// continuavano a contare fra le righe da azzerare.
export function renderTrash(entries, extras, onRestore, onRestoreExpense) {
  const list = $('trash-list');
  list.replaceChildren();
  const rows = entries
    .filter((e) => e.deletedAt != null)
    .map((e) => ({ kind: 'in', e }))
    .concat((extras ?? []).filter((x) => x.deletedAt != null).map((x) => ({ kind: 'out', e: x })))
    .sort((a, b) => b.e.deletedAt - a.e.deletedAt);
  // Il bottone di svuotamento riparte sempre dal primo tempo: mai
  // trovarlo già "armato" riaprendo il cestino.
  const emptyBtn = $('trash-empty');
  emptyBtn.hidden = rows.length === 0;
  emptyBtn.dataset.armed = '';
  emptyBtn.classList.remove('armed');
  emptyBtn.textContent = rows.length === 1
    ? 'Svuota cestino (1 riga)'
    : `Svuota cestino (${rows.length} righe)`;
  $('trash-note').textContent = rows.length === 0
    ? 'Le righe cestinate restano qui finché non le svuoti.'
    : 'Svuotare cancella per sempre: queste righe non si potranno più ripristinare.';
  if (rows.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Il cestino è vuoto';
    list.append(li);
    return;
  }
  for (const { kind, e } of rows) {
    const li = document.createElement('li');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.dataset.ch = kind === 'in' ? e.channel : 'X';
    badge.textContent = kind === 'in' ? e.channel : '−';
    const label = document.createElement('span');
    label.className = 'amount';
    label.textContent = kind === 'in'
      ? `${formatCents(e.amountCents)} · ${e.date} · ${CH_SHORT[e.channel]}`
      : `${formatCents(e.amountCents)} · ${e.date} · ${e.label}`;
    label.style.flex = '1';
    const restore = document.createElement('button');
    restore.className = 'restore';
    restore.type = 'button';
    restore.textContent = 'Ripristina';
    restore.addEventListener('click', () => (kind === 'in' ? onRestore(e.id) : onRestoreExpense(e.id)));
    li.append(badge, label, restore);
    list.append(li);
  }
}

// Rendering della schermata registro. Funzioni pure DOM: ricevono lo
// stato, ridisegnano. Nessuno stato proprio oltre il timer del toast.

import { formatCents, todayISO } from './money.js';
import { dayTotals, yearDeclared } from './totals.js';

const $ = (id) => document.getElementById(id);
const CH_NAMES = { B: 'bancomat', S: 'satispay', R: 'ricevuta', C: 'cash' };
const THRESHOLD_CENTS = 8_500_000; // 85.000,00 € in centesimi

export function renderDate(dateISO) {
  const btn = $('btn-date');
  if (dateISO === todayISO()) {
    btn.textContent = 'oggi';
    btn.classList.remove('not-today');
  } else {
    const [y, m, d] = dateISO.split('-');
    btn.textContent = `${d}/${m}/${y.slice(2)}`;
    btn.classList.add('not-today');
  }
}

export function renderDay(entries, dateISO, onRowTap) {
  const t = dayTotals(entries, dateISO);
  for (const ch of ['B', 'S', 'R', 'C']) $(`tot-${ch}`).textContent = formatCents(t[ch]);
  $('tot-day').textContent = formatCents(t.total);

  const list = $('day-list');
  list.replaceChildren();
  const rows = entries
    .filter((e) => e.deletedAt == null && e.date === dateISO)
    .sort((a, b) => b.createdAt - a.createdAt);

  if (rows.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nessun incasso registrato';
    list.append(li);
    return;
  }
  for (const e of rows) {
    const li = document.createElement('li');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.dataset.ch = e.channel;
    badge.textContent = e.channel;
    const amount = document.createElement('span');
    amount.className = 'amount';
    amount.textContent = formatCents(e.amountCents);
    const time = document.createElement('span');
    time.className = 'time';
    const d = new Date(e.createdAt);
    time.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    li.append(badge, amount, time);
    li.addEventListener('click', () => onRowTap(e.id));
    list.append(li);
  }
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

let toastTimer = null;
export function showToast(text, onUndo) {
  const toast = $('toast');
  $('toast-text').textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
  $('toast-undo').onclick = () => {
    clearTimeout(toastTimer);
    toast.hidden = true;
    onUndo();
  };
}

export function showBanner(text) {
  const b = $('banner');
  b.textContent = text;
  b.hidden = false;
}

export function showExportReminder(visible) {
  $('export-reminder').hidden = !visible;
}

export function renderTrash(entries, onRestore) {
  const list = $('trash-list');
  list.replaceChildren();
  const rows = entries
    .filter((e) => e.deletedAt != null)
    .sort((a, b) => b.deletedAt - a.deletedAt);
  if (rows.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Il cestino è vuoto';
    list.append(li);
    return;
  }
  for (const e of rows) {
    const li = document.createElement('li');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.dataset.ch = e.channel;
    badge.textContent = e.channel;
    const label = document.createElement('span');
    label.className = 'amount';
    label.textContent = `${formatCents(e.amountCents)} · ${e.date} · ${CH_NAMES[e.channel]}`;
    label.style.flex = '1';
    const restore = document.createElement('button');
    restore.className = 'restore';
    restore.type = 'button';
    restore.textContent = 'Ripristina';
    restore.addEventListener('click', () => onRestore(e.id));
    li.append(badge, label, restore);
    list.append(li);
  }
}

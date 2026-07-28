// Bootstrap e orchestrazione: stato in memoria, eventi, persistenza.
// Regola fissa: prima si scrive su disco, poi si aggiorna lo schermo.

import { parseAmount } from './parser.js';
import { formatCents, todayISO } from './money.js';
import { initDB, saveEntry, purgeEntries, requestPersistence } from './db.js';
import * as ui from './ui.js';
import { renderMonth } from './month.js';

const CH_NAMES = { B: 'Bancomat', S: 'Satispay', R: 'Contante con ricevuta', C: 'Cash' };
const EXPORT_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

const state = {
  entries: [],
  currentDate: todayISO(),
  buffer: '',
  monthShown: todayISO().slice(0, 7),
  editingId: null,
};

const $ = (id) => document.getElementById(id);

// ---------- persistenza con segnalazione errori ----------

async function persist(entry) {
  try {
    await saveEntry(entry, state.entries);
  } catch (err) {
    ui.showBanner('ATTENZIONE: salvataggio non riuscito. Non chiudere l\'app e fai subito un export dei dati.');
    throw err;
  }
}

// ---------- registro ----------

function refreshRegistro() {
  ui.renderDate(state.currentDate);
  ui.renderDay(state.entries, state.currentDate, openEdit);
  ui.renderCounter(state.entries);
  ui.renderAmount(state.buffer);
  ui.setChannelsEnabled(parseAmount(state.buffer) !== null);
}

async function insert(channel) {
  const cents = parseAmount(state.buffer);
  if (cents === null) return;
  const entry = {
    id: crypto.randomUUID(),
    date: state.currentDate,
    amountCents: cents,
    channel,
    createdAt: Date.now(),
    deletedAt: null,
  };
  state.entries.push(entry);
  await persist(entry);
  state.buffer = '';
  refreshRegistro();
  ui.showToast(`${formatCents(cents)} ${CH_NAMES[channel]}`, () => undo(entry.id));
}

async function undo(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  e.deletedAt = Date.now();
  await persist(e);
  refreshRegistro();
}

function onKey(k) {
  if (k === 'del') {
    state.buffer = state.buffer.slice(0, -1);
  } else if (k === ',') {
    if (state.buffer && !state.buffer.includes(',')) state.buffer += ',';
  } else {
    const [int, dec] = state.buffer.split(',');
    if (dec !== undefined) {
      if (dec.length < 2) state.buffer += k;
    } else if (int.length < 6) {
      state.buffer += k;
    }
  }
  ui.renderAmount(state.buffer);
  ui.setChannelsEnabled(parseAmount(state.buffer) !== null);
}

// ---------- modifica riga ----------

function openEdit(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  state.editingId = id;
  $('edit-amount').value = (e.amountCents / 100).toFixed(2).replace('.', ',');
  $('edit-channel').value = e.channel;
  $('edit-date').value = e.date;
  $('edit-sheet').showModal();
}

async function saveEdit() {
  const e = state.entries.find((x) => x.id === state.editingId);
  if (!e) return;
  const cents = parseAmount($('edit-amount').value);
  const date = $('edit-date').value;
  if (cents === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    $('edit-amount').style.borderColor = 'var(--danger)';
    return;
  }
  e.amountCents = cents;
  e.channel = $('edit-channel').value;
  e.date = date;
  await persist(e);
  $('edit-sheet').close();
  refreshRegistro();
}

async function deleteEdit() {
  const e = state.entries.find((x) => x.id === state.editingId);
  if (!e) return;
  e.deletedAt = Date.now();
  await persist(e);
  $('edit-sheet').close();
  refreshRegistro();
}

// ---------- cestino ----------

async function restore(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  e.deletedAt = null;
  await persist(e);
  ui.renderTrash(state.entries, restore);
  refreshRegistro();
}

// Svuota cestino in due tempi: il primo tocco arma il bottone, il
// secondo cancella. Nessuna finestra di sistema, e per sbaglio non
// si cancella niente. Le righe attive non vengono mai toccate.
async function emptyTrash() {
  const btn = $('trash-empty');
  const trashed = state.entries.filter((e) => e.deletedAt != null);
  if (trashed.length === 0) return;

  if (btn.dataset.armed !== 'si') {
    btn.dataset.armed = 'si';
    btn.classList.add('armed');
    btn.textContent = trashed.length === 1
      ? 'Tocca di nuovo: cancello 1 riga per sempre'
      : `Tocca di nuovo: cancello ${trashed.length} righe per sempre`;
    clearTimeout(emptyTrash.timer);
    // Se ci ripensa e non tocca più, il bottone si disarma da solo.
    emptyTrash.timer = setTimeout(() => ui.renderTrash(state.entries, restore), 6000);
    return;
  }

  clearTimeout(emptyTrash.timer);
  const ids = trashed.map((e) => e.id);
  const remaining = state.entries.filter((e) => e.deletedAt == null);
  try {
    await purgeEntries(ids, remaining);
  } catch {
    ui.showBanner('ATTENZIONE: svuotamento non riuscito. I dati sono ancora tutti al loro posto.');
    ui.renderTrash(state.entries, restore);
    return;
  }
  state.entries = remaining;
  ui.renderTrash(state.entries, restore);
  refreshRegistro();
  ui.showToast(
    ids.length === 1 ? 'Cestino svuotato: 1 riga cancellata.' : `Cestino svuotato: ${ids.length} righe cancellate.`,
    null,
    4000,
  );
}

// ---------- viste ----------

function showView(name) {
  $('view-registro').hidden = name !== 'registro';
  $('view-mese').hidden = name !== 'mese';
  $('tab-registro').classList.toggle('active', name === 'registro');
  $('tab-mese').classList.toggle('active', name === 'mese');
  // refreshRegistro come callback: dopo un import da backup anche il
  // registro deve ridisegnarsi, non solo la vista mese.
  if (name === 'mese') renderMonth($('view-mese'), state, refreshRegistro);
}

function checkExportReminder() {
  const last = Number(localStorage.getItem('ri-lastExport') ?? localStorage.getItem('ri-firstRun') ?? Date.now());
  const hasData = state.entries.some((e) => e.deletedAt == null);
  ui.showExportReminder(hasData && Date.now() - last > EXPORT_REMINDER_MS);
}

// ---------- avvio ----------

async function main() {
  if (!localStorage.getItem('ri-firstRun')) localStorage.setItem('ri-firstRun', String(Date.now()));

  const { entries, recovered } = await initDB();
  state.entries = entries;
  if (recovered) {
    ui.showBanner('Recupero automatico riuscito: i dati sono stati ripristinati dalla copia di sicurezza.');
  }

  const persisted = await requestPersistence();
  if (!persisted && entries.length > 0) {
    ui.showExportReminder(true);
  }
  checkExportReminder();
  refreshRegistro();

  // tastierino
  $('keypad').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (b) onKey(b.dataset.k);
  });
  $('channel-keys').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (b && !b.disabled) insert(b.dataset.ch);
  });

  // data — su iOS il tocco sull'input trasparente apre il picker
  // nativo da solo; showPicker() serve solo ai browser desktop, dove
  // il click nel campo non basta. Se lancia, il tocco nativo ha già
  // fatto il lavoro.
  $('date-picker').addEventListener('click', () => {
    try { $('date-picker').showPicker?.(); } catch { /* niente da fare */ }
  });
  $('date-picker').addEventListener('change', () => {
    if ($('date-picker').value) {
      state.currentDate = $('date-picker').value;
      refreshRegistro();
    }
  });

  // sheet modifica
  $('edit-save').addEventListener('click', saveEdit);
  $('edit-delete').addEventListener('click', deleteEdit);
  $('edit-cancel').addEventListener('click', () => $('edit-sheet').close());

  // cestino
  $('btn-trash').addEventListener('click', () => {
    ui.renderTrash(state.entries, restore);
    $('trash-sheet').showModal();
  });
  $('trash-empty').addEventListener('click', emptyTrash);
  $('trash-close').addEventListener('click', () => {
    clearTimeout(emptyTrash.timer);
    $('trash-sheet').close();
  });

  // tab
  $('tab-registro').addEventListener('click', () => showView('registro'));
  $('tab-mese').addEventListener('click', () => showView('mese'));

  // service worker (registrato per ultimo: mai bloccare l'avvio)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

main();

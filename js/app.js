// Bootstrap e orchestrazione: stato in memoria, eventi, persistenza.
// Regola fissa: prima si scrive su disco, poi si aggiorna lo schermo.

import { parseAmount } from './parser.js';
import { formatCents, todayISO } from './money.js';
import { initDB, saveEntry, saveExtra, purgeAll, requestPersistence } from './db.js';
import * as ui from './ui.js';
import { renderMonth } from './month.js';
import { CH_NAMES, MSG_SAVE_FAILED, MSG_MIRROR_FAILED } from './channels.js';
import { parseExpenseInput, MAX_LABEL, DEFAULT_EXPENSE_LABEL } from './expenses.js';

const EXPORT_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

const state = {
  entries: [],
  extras: [],
  currentDate: todayISO(),
  buffer: '',
  monthShown: todayISO().slice(0, 7),
  editingId: null,
  editingExpenseId: null,
};

const $ = (id) => document.getElementById(id);

// ---------- persistenza con segnalazione errori ----------

// Un mirror non scritto non è un salvataggio fallito: il dato è
// nell'archivio primario. Dirlo con le stesse parole spaventava per
// niente e faceva fare export inutili.
function reportWriteError(err) {
  ui.showBanner(err?.name === 'MirrorError' ? MSG_MIRROR_FAILED : MSG_SAVE_FAILED);
}

async function persist(entry) {
  try {
    await saveEntry(entry, state.entries);
  } catch (err) {
    reportWriteError(err);
    throw err;
  }
}

async function persistExtra(extra) {
  try {
    await saveExtra(extra, state.extras);
  } catch (err) {
    reportWriteError(err);
    throw err;
  }
}

// ---------- registro ----------

function refreshRegistro() {
  ui.renderDate(state.currentDate);
  ui.renderDay(state.entries, state.extras, state.currentDate, openEdit, openExpense);
  ui.renderDayNet(state.entries, state.extras, state.currentDate);
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
  try {
    await persist(entry);
  } catch (err) {
    // Se non è finita su disco, la riga non deve restare sullo schermo:
    // sparirebbe da sola alla riapertura. Con MirrorError invece il
    // dato è salvato davvero, quindi resta dov'è.
    if (err?.name !== 'MirrorError') {
      state.entries = state.entries.filter((e) => e.id !== entry.id);
      refreshRegistro();
    }
    return;
  }
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
  const prima = { amountCents: e.amountCents, channel: e.channel, date: e.date };
  e.amountCents = cents;
  e.channel = $('edit-channel').value;
  e.date = date;
  try {
    await persist(e);
  } catch (err) {
    if (err?.name !== 'MirrorError') Object.assign(e, prima); // su disco è rimasta la versione vecchia
    refreshRegistro();
    return;
  }
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

// ---------- spese variabili ----------

// Stesso foglio per aggiungere e per modificare: con id null si parte
// dall'importo eventualmente già digitato sul tastierino.
function openExpense(id = null) {
  state.editingExpenseId = id;
  const x = id ? state.extras.find((e) => e.id === id) : null;
  $('expense-title').textContent = x ? 'Modifica spesa' : 'Aggiungi una spesa';
  $('expense-amount').value = x
    ? (x.amountCents / 100).toFixed(2).replace('.', ',')
    : state.buffer;
  $('expense-amount').style.borderColor = '';
  $('expense-label').value = x ? x.label : '';
  $('expense-date').value = x ? x.date : state.currentDate;
  $('expense-delete').hidden = !x;
  $('expense-sheet').showModal();
}

async function saveExpense() {
  const rawAmount = $('expense-amount').value;
  const rawLabel = $('expense-label').value.trim();
  // Chi scrive tutto di fila nel primo campo — "40 shopping" — non deve
  // sbagliare: se la voce è vuota, l'importo si legge insieme al testo.
  const insieme = rawLabel ? null : parseExpenseInput(rawAmount);
  const cents = insieme ? insieme.amountCents : parseAmount(rawAmount);
  const date = $('expense-date').value;
  if (cents === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    $('expense-amount').style.borderColor = 'var(--danger)';
    return;
  }
  const label = rawLabel.slice(0, MAX_LABEL) || insieme?.label || DEFAULT_EXPENSE_LABEL;
  let x = state.extras.find((e) => e.id === state.editingExpenseId);
  const prima = x ? { amountCents: x.amountCents, label: x.label, date: x.date } : null;
  if (x) {
    x.amountCents = cents;
    x.label = label;
    x.date = date;
  } else {
    x = {
      id: crypto.randomUUID(),
      kind: 'var',
      label,
      amountCents: cents,
      date,
      createdAt: Date.now(),
      deletedAt: null,
    };
    state.extras.push(x);
    state.buffer = '';
  }
  try {
    await persistExtra(x);
  } catch (err) {
    if (err?.name !== 'MirrorError') {
      // niente su disco: si torna esattamente com'era prima
      if (prima) Object.assign(x, prima);
      else state.extras = state.extras.filter((e) => e.id !== x.id);
      refreshRegistro();
    }
    return;
  }
  $('expense-sheet').close();
  refreshRegistro();
}

async function deleteExpense() {
  const x = state.extras.find((e) => e.id === state.editingExpenseId);
  if (!x) return;
  x.deletedAt = Date.now();
  try {
    await persistExtra(x);
  } catch (err) {
    if (err?.name !== 'MirrorError') x.deletedAt = null;
    refreshRegistro();
    return;
  }
  $('expense-sheet').close();
  refreshRegistro();
}

// ---------- cestino ----------

async function restore(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  const prima = e.deletedAt;
  e.deletedAt = null;
  try {
    await persist(e);
  } catch (err) {
    if (err?.name !== 'MirrorError') e.deletedAt = prima;
  }
  showTrash();
  refreshRegistro();
}

async function restoreExpense(id) {
  const x = state.extras.find((e) => e.id === id);
  if (!x) return;
  const prima = x.deletedAt;
  x.deletedAt = null;
  try {
    await persistExtra(x);
  } catch (err) {
    if (err?.name !== 'MirrorError') x.deletedAt = prima;
  }
  showTrash();
  refreshRegistro();
}

function showTrash() {
  ui.renderTrash(state.entries, state.extras, restore, restoreExpense);
}

// Svuota cestino in due tempi: il primo tocco arma il bottone, il
// secondo cancella. Nessuna finestra di sistema, e per sbaglio non
// si cancella niente. Le righe attive non vengono mai toccate.
async function emptyTrash() {
  const btn = $('trash-empty');
  const trashedEntries = state.entries.filter((e) => e.deletedAt != null);
  const trashedExtras = state.extras.filter((x) => x.deletedAt != null);
  const quante = trashedEntries.length + trashedExtras.length;
  if (quante === 0) return;

  if (btn.dataset.armed !== 'si') {
    btn.dataset.armed = 'si';
    btn.classList.add('armed');
    btn.textContent = quante === 1
      ? 'Tocca di nuovo: cancello 1 riga per sempre'
      : `Tocca di nuovo: cancello ${quante} righe per sempre`;
    clearTimeout(emptyTrash.timer);
    // Se ci ripensa e non tocca più, il bottone si disarma da solo.
    emptyTrash.timer = setTimeout(showTrash, 6000);
    return;
  }

  clearTimeout(emptyTrash.timer);
  const remainingEntries = state.entries.filter((e) => e.deletedAt == null);
  const remainingExtras = state.extras.filter((x) => x.deletedAt == null);
  try {
    await purgeAll({
      entryIds: trashedEntries.map((e) => e.id),
      extraIds: trashedExtras.map((x) => x.id),
      remainingEntries,
      remainingExtras,
    });
  } catch (err) {
    if (err?.name === 'MirrorError') {
      // cancellazione avvenuta davvero: lo stato va aggiornato lo stesso
      state.entries = remainingEntries;
      state.extras = remainingExtras;
      ui.showBanner(MSG_MIRROR_FAILED);
    } else {
      ui.showBanner('ATTENZIONE: svuotamento non riuscito. I dati sono ancora tutti al loro posto.');
    }
    showTrash();
    refreshRegistro();
    return;
  }
  state.entries = remainingEntries;
  state.extras = remainingExtras;
  showTrash();
  refreshRegistro();
  ui.showToast(
    quante === 1 ? 'Cestino svuotato: 1 riga cancellata.' : `Cestino svuotato: ${quante} righe cancellate.`,
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

  const { entries, extras, recovered, idbDown, mirrorDown } = await initDB();
  state.entries = entries;
  state.extras = extras;
  // Un archivio che non risponde non deve restare un fatto privato
  // dell'app: se resta una copia sola, l'export manuale diventa
  // l'unica rete e va detto subito.
  if (idbDown) {
    ui.showBanner('ATTENZIONE: l\'archivio principale non risponde. Stai lavorando sulla sola copia di sicurezza: fai un export appena puoi.');
  } else if (mirrorDown) {
    ui.showBanner(MSG_MIRROR_FAILED);
  } else if (recovered) {
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

  // spese
  $('btn-expense').addEventListener('click', () => openExpense(null));
  $('expense-save').addEventListener('click', saveExpense);
  $('expense-delete').addEventListener('click', deleteExpense);
  $('expense-cancel').addEventListener('click', () => $('expense-sheet').close());

  // cestino
  $('btn-trash').addEventListener('click', () => {
    showTrash();
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

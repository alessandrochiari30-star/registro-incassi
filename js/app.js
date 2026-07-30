// Bootstrap e orchestrazione: stato in memoria, eventi, persistenza.
// Regola fissa: prima si scrive su disco, poi si aggiorna lo schermo.

import { parseAmount } from './parser.js';
import { formatCents, todayISO } from './money.js';
import {
  initDB, saveEntry, saveExtra, purgeAll, requestPersistence,
  isMirrorError, isSaved, writeMessage,
} from './db.js';
import * as ui from './ui.js';
import { renderMonth } from './month.js';
import { CH_NAMES, MSG_MIRROR_FAILED } from './channels.js';
import { parseExpenseInput, MAX_LABEL, DEFAULT_EXPENSE_LABEL } from './expenses.js';
import { exportReminder } from './reminder.js';

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

// Ogni scrittura passa di qui, senza eccezioni. Ritorna true se il
// dato è finito sul disco, e allora il gesto va portato a termine fino
// in fondo (schermo aggiornato, foglio chiuso, toast).
//
// Se salta uno solo dei due archivi il dato è comunque su questo
// telefono: si avvisa con parole diverse ma il gesto va avanti. Prima
// ogni percorso decideva da sé: due uscivano a metà strada dopo aver
// salvato davvero — la riga restava invisibile e veniva riscritta,
// oppure una cancellazione riuscita continuava a mostrarsi. E due non
// prendevano l'errore del tutto.
//
// rollback rimette lo stato in memoria com'era: si chiama solo quando
// non è arrivato niente da nessuna parte.
async function write(save, rollback = null) {
  try {
    await save();
    return true;
  } catch (err) {
    ui.showBanner(writeMessage(err));
    if (isSaved(err)) return true; // il dato c'è: il gesto continua
    rollback?.();
    return false;
  }
}

const persist = (entry, rollback) => write(() => saveEntry(entry, state.entries), rollback);
const persistExtra = (extra, rollback) => write(() => saveExtra(extra, state.extras), rollback);

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
  // Se non è finita su disco, la riga non deve restare sullo schermo:
  // sparirebbe da sola alla riapertura.
  const ok = await persist(entry, () => {
    state.entries = state.entries.filter((e) => e.id !== entry.id);
  });
  if (!ok) {
    refreshRegistro();
    return;
  }
  state.buffer = '';
  refreshRegistro();
  ui.showToast(`${formatCents(cents)} ${CH_NAMES[channel]}`, () => undo(entry.id));
}

async function undo(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  const prima = e.deletedAt;
  e.deletedAt = Date.now();
  await persist(e, () => { e.deletedAt = prima; });
  refreshRegistro();
}

function onKey(k) {
  // La conferma di prima non deve restare aperta mentre si scrive
  // l'incasso dopo: il suo «Annulla» sta sopra i tasti dei canali.
  ui.hideToast();
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
  // su disco è rimasta la versione vecchia: si torna a quella
  const ok = await persist(e, () => Object.assign(e, prima));
  if (!ok) {
    refreshRegistro();
    return;
  }
  $('edit-sheet').close();
  refreshRegistro();
}

async function deleteEdit() {
  const e = state.entries.find((x) => x.id === state.editingId);
  if (!e) return;
  const prima = e.deletedAt;
  e.deletedAt = Date.now();
  const ok = await persist(e, () => { e.deletedAt = prima; });
  if (!ok) {
    refreshRegistro();
    return;
  }
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
  const bufferPrima = state.buffer;
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
  // niente su disco: si torna esattamente com'era prima, importo
  // digitato compreso
  const ok = await persistExtra(x, () => {
    if (prima) Object.assign(x, prima);
    else state.extras = state.extras.filter((e) => e.id !== x.id);
    state.buffer = bufferPrima;
  });
  if (!ok) {
    refreshRegistro();
    return;
  }
  $('expense-sheet').close();
  refreshRegistro();
}

async function deleteExpense() {
  const x = state.extras.find((e) => e.id === state.editingExpenseId);
  if (!x) return;
  const prima = x.deletedAt;
  x.deletedAt = Date.now();
  const ok = await persistExtra(x, () => { x.deletedAt = prima; });
  if (!ok) {
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
  await persist(e, () => { e.deletedAt = prima; });
  showTrash();
  refreshRegistro();
}

async function restoreExpense(id) {
  const x = state.extras.find((e) => e.id === id);
  if (!x) return;
  const prima = x.deletedAt;
  x.deletedAt = null;
  await persistExtra(x, () => { x.deletedAt = prima; });
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
    if (isMirrorError(err)) {
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

// `persisted` arriva dall'avvio: false vuol dire che il browser può
// buttare via i dati quando gli pare (scheda Safari su iOS, navigazione
// privata). È un motivo diverso dall'export vecchio e non deve essere
// spento da quello.
function checkExportReminder(persisted = true) {
  let last = null;
  try {
    last = localStorage.getItem('ri-lastExport') ?? localStorage.getItem('ri-firstRun');
  } catch { /* localStorage inaccessibile: si ragiona senza */ }
  const promemoria = exportReminder({
    hasData: state.entries.some((e) => e.deletedAt == null),
    persisted,
    lastExportAt: last === null ? null : Number(last),
  });
  ui.showExportReminder(promemoria.visible, promemoria.text);
}

// ---------- avvio ----------

async function main() {
  // Se il browser vieta del tutto localStorage (cookie bloccati), il
  // solo leggerlo lancia: l'app deve partire lo stesso, non morire con
  // uno schermo bianco prima di disegnare qualcosa.
  try {
    if (!localStorage.getItem('ri-firstRun')) localStorage.setItem('ri-firstRun', String(Date.now()));
  } catch { /* si va avanti senza: il promemoria export ragionerà senza data */ }

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
  checkExportReminder(persisted);
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

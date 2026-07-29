// Riepilogo mensile: la schermata che si guarda con calma.
// Ricostruita da zero a ogni apertura, sempre derivata dalle righe.

import { formatCents, todayISO } from './money.js';
import { monthStats, yearDeclared, prevMonthDelta, bigVisitShare } from './totals.js';
import { dailyBarsSVG, channelBarSVG, thresholdBarSVG } from './chart.js';
import { toCSV, toJSON } from './exporter.js';
import { parseBackup, mergeBackup } from './backup.js';
import { initDB, saveAll, saveAllExtras, saveExtra, wipeAll } from './db.js';
import { resetGate, gateHint } from './reset.js';
import { showToast, showBanner } from './ui.js';
import {
  CHANNELS, CH_SHORT, THRESHOLD_CENTS, INPS_MIN_CENTS, BIG_VISIT_CENTS,
  MSG_SAVE_FAILED, MSG_MIRROR_FAILED,
} from './channels.js';
import { parseAmount } from './parser.js';
import {
  FIXED_ID, DEFAULT_FIXED_LABEL, fixedEntry, fixedTotal,
  variableItems, variableTotal, monthBalance, breakEvenDay,
} from './expenses.js';

// Backup fatto durante questa apertura dell'app: sblocca il secondo
// lucchetto dell'azzeramento. Vive in memoria apposta — chiusa l'app
// torna a zero, così il permesso non si eredita da ieri.
let backupOkAt = null;

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Download diretto. L'ancora deve stare nel DOM (alcuni browser
// ignorano il click su un nodo staccato) e l'URL va revocato dopo,
// non subito: revocarlo nello stesso istante annulla il download.
function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
  return 'saved';
}

// Ritorna 'shared' (foglio di condivisione), 'saved' (download
// diretto) o null solo se l'utente ha annullato di sua volontà.
// Ogni altro rifiuto dello share ripiega sul download: su Android il
// JSON è spesso un tipo che il sistema non accetta di condividere, e
// prima quel caso restava muto — il bottone sembrava rotto.
async function shareFile(filename, content, mime) {
  const file = new File([content], filename, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return null; // annullato: silenzio
      // altro errore: si continua col download qui sotto
    }
  }
  return downloadFile(file);
}

function markExported() {
  localStorage.setItem('ri-lastExport', String(Date.now()));
  document.getElementById('export-reminder').hidden = true;
}

// Conferma discreta a export riuscito; con null (share annullato
// dall'utente) non succede niente. Un errore vero non resta mai muto.
// Ritorna l'esito: la zona pericolosa lo usa per sapere se il backup
// è davvero uscito prima di sbloccare l'azzeramento.
async function runExport(filename, content, mime) {
  let outcome = null;
  try {
    outcome = await shareFile(filename, content, mime);
  } catch (err) {
    showToast('Export non riuscito (' + (err?.name ?? 'errore') + '). Riprova.', null, 8000);
    return null;
  }
  if (!outcome) return null;
  markExported();
  showToast(
    outcome === 'shared' ? 'Export condiviso.' : `Scaricato: ${filename}`,
    null,
    4000,
  );
  return outcome;
}

// Messaggi d'errore dell'import, in italiano semplice.
const IMPORT_ERRORS = {
  json: 'Non riesco a leggere questo file. Controlla di aver scelto il file di backup giusto (finisce con .json).',
  formato: 'Questo file non sembra un backup di Registro incassi.',
  righe: 'Il file sembra danneggiato: per sicurezza non ho importato niente. Prova con un altro backup.',
};

export function importMessage(added, existing, addedExtras = 0) {
  const rec = added === 1 ? '1 riga ripristinata' : `${added} righe ripristinate`;
  const pres = existing === 1 ? '1 era già presente' : `${existing} erano già presenti`;
  const spese = addedExtras === 1 ? ', più 1 voce di spesa' : `, più ${addedExtras} voci di spesa`;
  const coda = addedExtras > 0 ? spese : '';
  if (existing === 0) return `Backup caricato: ${rec}${coda}.`;
  return `Backup caricato: ${rec}, ${pres}${coda}.`;
}

// Legge il file scelto, valida, fonde e salva. Ogni esito ha un
// messaggio; lo schermo si aggiorna solo a salvataggio riuscito.
async function importBackupFile(file, container, state, onDataChanged) {
  let text = '';
  try {
    text = await file.text();
  } catch {
    showToast(IMPORT_ERRORS.json, null, 8000);
    return;
  }
  const parsed = parseBackup(text);
  if (!parsed.ok) {
    showToast(IMPORT_ERRORS[parsed.error], null, 8000);
    return;
  }
  // Un backup può contenere solo uscite (per esempio fatto subito dopo
  // un azzeramento): vuoto vuol dire vuoto di tutto.
  if (parsed.entries.length === 0 && (parsed.extras?.length ?? 0) === 0) {
    showToast('Il file è un backup valido ma non contiene righe.', null, 8000);
    return;
  }
  const { entries, added, existing } = mergeBackup(state.entries, parsed.entries);
  const merged = mergeBackup(state.extras, parsed.extras ?? []);
  if (added === 0 && merged.added === 0) {
    showToast('Niente da ripristinare: le righe del backup sono già tutte qui.', null, 8000);
    return;
  }
  // Ogni pezzo salvato entra subito nello stato: se il secondo salvataggio
  // fallisce, la memoria non deve restare più povera del disco, altrimenti
  // la scrittura successiva specchierebbe l'insieme ridotto.
  try {
    await saveAll(entries);
    state.entries = entries;
    if (merged.added > 0) await saveAllExtras(merged.entries);
    state.extras = merged.entries;
  } catch (err) {
    showBanner(err?.name === 'MirrorError' ? MSG_MIRROR_FAILED : MSG_SAVE_FAILED);
    onDataChanged?.();
    renderMonth(container, state, onDataChanged);
    return;
  }
  onDataChanged?.();
  renderMonth(container, state, onDataChanged);
  showToast(importMessage(added, existing, merged.added), null, 8000);
}

// Testo scritto dall'utente dentro l'HTML generato: va sempre passato
// di qui. Le voci di spesa possono arrivare da un file di backup, che
// è l'unico canale con cui entra roba scritta altrove — senza escape
// una label manomessa eseguirebbe codice nell'app che custodisce i
// dati.
export function esc(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// "gio 14 ago" — giorno per esteso ma corto, come si legge a voce.
function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
}

function dayReadout(d) {
  if (!d) return 'Tocca una barra per vedere il giorno e il suo incasso.';
  if (d.total === 0) return `${dayLabel(d.date)} · nessun incasso`;
  const visite = d.visits === 1 ? '1 visita' : `${d.visits} visite`;
  return `${dayLabel(d.date)} · ${formatCents(d.total)} · ${visite}`;
}

// Il tocco su una colonna del grafico: evidenzia quella colonna e
// scrive il dettaglio sotto. Niente tooltip flottanti, che su un dito
// finiscono sempre sotto il dito stesso.
function wireDailyChart(container, perDay) {
  const chart = container.querySelector('#daily-chart');
  const readout = container.querySelector('#day-readout');
  chart.addEventListener('click', (ev) => {
    const col = ev.target.closest?.('.day-col');
    if (!col) return;
    const day = Number(col.dataset.day);
    for (const c of chart.querySelectorAll('.day-col.sel, .day-col.near')) c.classList.remove('sel', 'near');
    col.classList.add('sel');
    // Il numero acceso del giorno scelto ruberebbe spazio a quelli
    // dell'asse che gli stanno di fianco: quelli si tolgono di mezzo.
    for (const d of [day - 1, day + 1]) {
      chart.querySelector(`.day-col[data-day="${d}"]`)?.classList.add('near');
    }
    readout.textContent = dayReadout(perDay[day - 1]);
  });
}

// La voce delle spese fisse: una sola, si cambia scrivendoci sopra.
// Zero significa "non contarle", ed è una risposta legittima: qui non
// si tiene un bilancio, si dà un riferimento al pareggio.
function wireFixedCosts(container, state, onDataChanged) {
  const input = container.querySelector('#fix-amount');
  const btn = container.querySelector('#fix-save');
  if (!input || !btn) return;

  btn.addEventListener('click', async () => {
    const raw = input.value.trim();
    const cents = /^0([.,]0{1,2})?$/.test(raw) ? 0 : parseAmount(raw);
    if (cents === null) {
      input.style.borderColor = 'var(--danger)';
      return;
    }
    let x = fixedEntry(state.extras);
    const prima = x ? x.amountCents : null;
    if (x) {
      x.amountCents = cents;
    } else {
      x = {
        id: FIXED_ID,
        kind: 'fixed',
        label: DEFAULT_FIXED_LABEL,
        amountCents: cents,
        date: null,
        createdAt: Date.now(),
        deletedAt: null,
      };
      state.extras.push(x);
    }
    try {
      await saveExtra(x, state.extras);
    } catch (err) {
      if (err?.name !== 'MirrorError') {
        // non salvata: si torna al valore di prima invece di mostrarne
        // uno che sul disco non esiste
        if (prima === null) state.extras = state.extras.filter((e) => e.id !== FIXED_ID);
        else x.amountCents = prima;
        showBanner(MSG_SAVE_FAILED);
        renderMonth(container, state, onDataChanged);
        return;
      }
      showBanner(MSG_MIRROR_FAILED);
    }
    onDataChanged?.();
    renderMonth(container, state, onDataChanged);
    showToast('Spese fisse aggiornate.', null, 3000);
  });
}

// Zona pericolosa. Tre lucchetti (backup, parola, bottone sbloccato)
// più una conferma in due tempi sul bottone stesso, come nel cestino.
// L'azzeramento non passa mai da una finestra di sistema: deve essere
// una sequenza di gesti diversi fra loro.
function wireDangerZone(container, state, onDataChanged) {
  const zone = container.querySelector('#danger-zone');
  if (!zone) return;
  const btnBackup = container.querySelector('#dz-backup');
  const stateLine = container.querySelector('#dz-backup-state');
  const input = container.querySelector('#dz-phrase');
  const btnWipe = container.querySelector('#dz-wipe');
  const hint = container.querySelector('#dz-hint');
  // Conta tutto quello che sparirebbe — incassi, spese e voce fissa,
  // cestinate comprese — e lo dice diviso, perché "N righe" da solo
  // era un numero più alto di quello che l'utente vede in giro.
  const nIncassi = state.entries.length;
  const nUscite = state.extras.length;
  const rowCount = nIncassi + nUscite;
  const conteggio = `${nIncassi} ${nIncassi === 1 ? 'incasso' : 'incassi'} e ${nUscite} ${nUscite === 1 ? 'voce di spesa' : 'voci di spesa'}`;

  const disarm = () => {
    clearTimeout(wireDangerZone.timer);
    btnWipe.dataset.armed = '';
    btnWipe.classList.remove('armed');
    btnWipe.textContent = `3 · Cancella ${conteggio}`;
  };

  const refreshGate = () => {
    const gate = resetGate({ backupDone: backupOkAt !== null, phrase: input.value, rowCount });
    btnWipe.disabled = !gate.enabled;
    hint.textContent = gateHint(gate.reason);
    if (!gate.enabled) disarm();
  };

  const ora = (ts) => new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  stateLine.textContent = backupOkAt === null
    ? 'backup non ancora fatto in questa sessione'
    : `✓ backup fatto alle ${ora(backupOkAt)}`;
  disarm();
  refreshGate();

  btnBackup.addEventListener('click', async () => {
    const outcome = await runExport(`backup-incassi-${todayISO()}.json`, toJSON(state.entries, state.extras), 'application/json');
    if (!outcome) return; // annullato o fallito: il lucchetto resta chiuso
    backupOkAt = Date.now();
    stateLine.textContent = `✓ backup fatto alle ${ora(backupOkAt)}`;
    refreshGate();
  });

  input.addEventListener('input', refreshGate);

  btnWipe.addEventListener('click', async () => {
    const gate = resetGate({ backupDone: backupOkAt !== null, phrase: input.value, rowCount });
    if (!gate.enabled) return;

    if (btnWipe.dataset.armed !== 'si') {
      btnWipe.dataset.armed = 'si';
      btnWipe.classList.add('armed');
      btnWipe.textContent = 'Tocca di nuovo: cancello TUTTO per sempre';
      clearTimeout(wireDangerZone.timer);
      wireDangerZone.timer = setTimeout(disarm, 6000);
      return;
    }

    clearTimeout(wireDangerZone.timer);
    try {
      await wipeAll();
    } catch {
      // Può essere fallito a metà: si rilegge lo stato dal disco invece
      // di continuare a mostrare quello di prima.
      showBanner('ATTENZIONE: azzeramento non riuscito. Controlla i dati e fai subito un export.');
      try {
        const riletto = await initDB();
        state.entries = riletto.entries;
        state.extras = riletto.extras;
      } catch { /* si tiene quello che c'è in memoria */ }
      onDataChanged?.();
      renderMonth(container, state, onDataChanged);
      return;
    }
    state.entries = [];
    state.extras = [];
    backupOkAt = null;
    onDataChanged?.();
    renderMonth(container, state, onDataChanged);
    showToast(`Azzerato: cancellati ${conteggio}.`, null, 8000);
  });
}

// Card "Quanto resta": il conto del mese e il giorno in cui le spese
// sono coperte. Tono neutro per scelta — informa, non fa la predica.
function netCardHTML(state, ym, incomeCents, perDay) {
  const fisse = fixedTotal(state.extras);
  const variabili = variableTotal(state.extras, ym);
  const bilancio = monthBalance({ incomeCents, fixedCents: fisse, variableCents: variabili });
  const pareggio = breakEvenDay(perDay, bilancio.outflow);
  const pareggioTesto = bilancio.outflow === 0
    ? 'Nessuna spesa segnata in questo mese.'
    : pareggio.day
      ? `Spese del mese coperte dal ${pareggio.day}.`
      : `Ancora ${formatCents(pareggio.missingCents)} e le spese del mese sono coperte.`;
  const voci = variableItems(state.extras, ym)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((x) => `<li><span>${Number(x.date.slice(8))} · ${esc(x.label)}</span><b>${formatCents(x.amountCents)}</b></li>`)
    .join('');

  return `
    <div class="card">
      <h3>Quanto resta</h3>
      <div class="net-big ${bilancio.netCents >= 0 ? 'pos' : ''}">${bilancio.netCents < 0 ? '−' : ''}${formatCents(Math.abs(bilancio.netCents))}</div>
      <div class="net-note">${pareggioTesto}</div>
      <div class="fix-row">
        <label for="fix-amount">Spese fisse del mese</label>
        <input id="fix-amount" type="text" inputmode="decimal" value="${(fisse / 100).toFixed(2).replace('.', ',')}">
        <button id="fix-save" type="button">Salva</button>
      </div>
      <div class="net-rows">
        <div><span>Incassi</span><b>${formatCents(incomeCents)}</b></div>
        <div><span>Spese fisse</span><b>−${formatCents(fisse)}</b></div>
        <div><span>Spese aggiunte</span><b>−${formatCents(variabili)}</b></div>
      </div>
      ${voci ? `<ul class="exp-list">${voci}</ul>` : '<div class="net-note">Le spese si aggiungono dal registro, col tasto «− aggiungi una spesa».</div>'}
    </div>`;
}

// Zona pericolosa: esiste solo se c'è qualcosa da cancellare.
function dangerZoneHTML(state) {
  if (state.entries.length + state.extras.length === 0) return '';
  return `
    <div class="card danger-zone" id="danger-zone">
      <h3>Zona pericolosa</h3>
      <p class="dz-note">Azzerare cancella <strong>tutte</strong> le righe di tutti i mesi, cestino e spese comprese. Non si torna indietro: dopo esiste solo il file di backup.</p>
      <ol class="dz-steps">
        <li>
          <button id="dz-backup" type="button">1 · Fai il backup adesso</button>
          <span id="dz-backup-state" class="dz-state"></span>
        </li>
        <li>
          <label for="dz-phrase">2 · Scrivi <b>AZZERA</b> qui sotto</label>
          <input id="dz-phrase" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="AZZERA">
        </li>
        <li>
          <button id="dz-wipe" type="button" class="dz-wipe" disabled></button>
          <span id="dz-hint" class="dz-state"></span>
        </li>
      </ol>
    </div>`;
}

export function renderMonth(container, state, onDataChanged) {
  const ym = state.monthShown;
  const s = monthStats(state.entries, ym);
  const { deltaPct } = prevMonthDelta(state.entries, ym);
  const year = Number(ym.slice(0, 4));
  const declared = yearDeclared(state.entries, year);

  const deltaHtml = deltaPct === null
    ? '<div class="delta">primo mese con dati</div>'
    : `<div class="delta ${deltaPct >= 0 ? 'up' : 'down'}">${deltaPct >= 0 ? '▲' : '▼'} ${Math.abs(deltaPct)}% sul mese precedente</div>`;

  const legend = CHANNELS
    .map((c) => `<span><span class="dot" style="background:var(--ch-${c})"></span>${c} ${CH_SHORT[c]} · ${formatCents(s.byChannel[c])}</span>`)
    .join('');

  const grosse = bigVisitShare(state.entries, ym, BIG_VISIT_CENTS);

  container.innerHTML = `
    <div class="month-nav">
      <button id="m-prev" type="button" aria-label="Mese precedente">‹</button>
      <h2>${monthLabel(ym)}</h2>
      <button id="m-next" type="button" aria-label="Mese successivo">›</button>
    </div>

    <div class="hero">
      <div class="big">${formatCents(s.total)}</div>
      ${deltaHtml}
    </div>

    <div class="card">
      <h3>Ripartizione per canale</h3>
      ${channelBarSVG(s.byChannel)}
      <div class="legend">${legend}</div>
    </div>

    <div class="card">
      <h3>Andamento giornaliero</h3>
      <div id="daily-chart">${dailyBarsSVG(s.perDay)}</div>
      <div id="day-readout" class="day-readout" aria-live="polite">${dayReadout(null)}</div>
    </div>

    ${netCardHTML(state, ym, s.total, s.perDay)}

    <div class="card">
      <h3>Da dove arriva il mese</h3>
      <div class="stat-grid">
        <div class="stat"><div class="v">${grosse.pctVisits}%</div><div class="l">delle visite è da 50 € in su</div></div>
        <div class="stat"><div class="v">${grosse.pctTotal}%</div><div class="l">dell'incasso arriva da quelle</div></div>
      </div>
      <div class="net-note">${grosse.bigVisits} visite su ${grosse.visits} · ${formatCents(grosse.bigTotal)} su ${formatCents(grosse.total)}</div>
    </div>

    <div class="card">
      <h3>Il mese in numeri</h3>
      <div class="stat-grid">
        <div class="stat"><div class="v">${s.visits}</div><div class="l">visite</div></div>
        <div class="stat"><div class="v">${s.workedDays}</div><div class="l">giorni lavorati</div></div>
        <div class="stat"><div class="v">${formatCents(s.avgPerWorkedDay)}</div><div class="l">media per giorno</div></div>
        <div class="stat"><div class="v">${formatCents(s.avgVisit)}</div><div class="l">scontrino medio</div></div>
        <div class="stat"><div class="v">${formatCents(s.avgVisitElectronic)}</div><div class="l">medio elettronico (B+S)</div></div>
        <div class="stat"><div class="v">${formatCents(s.avgVisitCash)}</div><div class="l">medio contante (R+C)</div></div>
      </div>
    </div>

    <div class="card">
      <h3>Progressivo ${year} verso 85.000 € (dichiarato B+S+R)</h3>
      ${thresholdBarSVG(declared, THRESHOLD_CENTS, { valueCents: INPS_MIN_CENTS, label: 'minimale INPS 28.072 €' })}
      <div class="legend"><span>${formatCents(declared)} · ${((declared / THRESHOLD_CENTS) * 100).toFixed(1)}% della soglia</span></div>
    </div>

    <div class="card">
      <h3>Export e backup</h3>
      <div class="export-row">
        <button id="exp-month" type="button">Esporta questo mese (CSV)</button>
        <button id="exp-all" type="button">Esporta tutto (CSV)</button>
        <button id="exp-json" type="button">Backup completo (JSON)</button>
        <button id="imp-json" type="button" class="import">Ripristina da backup</button>
      </div>
    </div>

    ${dangerZoneHTML(state)}
  `;

  // Input file separato dal bottone. Accept largo apposta: iOS Safari
  // è capriccioso col mime dei .json salvati da Mail/File (a volte li
  // marca text/plain), quindi estensione + i due mime coprono i casi
  // reali; il parser scarta comunque tutto ciò che non è un backup.
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json,text/json,text/plain';
  fileInput.hidden = true;
  container.append(fileInput);

  container.querySelector('#m-prev').addEventListener('click', () => {
    state.monthShown = shiftMonth(ym, -1);
    renderMonth(container, state, onDataChanged);
  });
  container.querySelector('#m-next').addEventListener('click', () => {
    state.monthShown = shiftMonth(ym, 1);
    renderMonth(container, state, onDataChanged);
  });

  container.querySelector('#exp-month').addEventListener('click', () => {
    const rows = state.entries.filter((e) => e.date.startsWith(ym + '-'));
    runExport(`incassi-${ym}.csv`, toCSV(rows), 'text/csv');
  });
  container.querySelector('#exp-all').addEventListener('click', () => {
    runExport(`incassi-tutti-${todayISO()}.csv`, toCSV(state.entries), 'text/csv');
  });
  container.querySelector('#exp-json').addEventListener('click', () => {
    runExport(`backup-incassi-${todayISO()}.json`, toJSON(state.entries, state.extras), 'application/json');
  });

  container.querySelector('#imp-json').addEventListener('click', () => fileInput.click());

  wireDailyChart(container, s.perDay);
  wireFixedCosts(container, state, onDataChanged);
  wireDangerZone(container, state, onDataChanged);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // consente di riscegliere lo stesso file
    if (!file) return;
    await importBackupFile(file, container, state, onDataChanged);
  });
}

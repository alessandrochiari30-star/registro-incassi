// Riepilogo mensile: la schermata che si guarda con calma.
// Ricostruita da zero a ogni apertura, sempre derivata dalle righe.

import { formatCents, todayISO } from './money.js';
import { monthStats, yearDeclared, prevMonthDelta } from './totals.js';
import { dailyBarsSVG, channelBarSVG, thresholdBarSVG } from './chart.js';
import { toCSV, toJSON } from './exporter.js';
import { parseBackup, mergeBackup } from './backup.js';
import { saveAll } from './db.js';
import { showToast, showBanner } from './ui.js';

const THRESHOLD_CENTS = 8_500_000;
const CH_NAMES = { B: 'Bancomat', S: 'Satispay', R: 'Ricevuta', C: 'Cash' };

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
async function runExport(filename, content, mime) {
  let outcome = null;
  try {
    outcome = await shareFile(filename, content, mime);
  } catch (err) {
    showToast('Export non riuscito (' + (err?.name ?? 'errore') + '). Riprova.', null, 8000);
    return;
  }
  if (!outcome) return;
  markExported();
  showToast(
    outcome === 'shared' ? 'Export condiviso.' : `Scaricato: ${filename}`,
    null,
    4000,
  );
}

// Messaggi d'errore dell'import, in italiano semplice.
const IMPORT_ERRORS = {
  json: 'Non riesco a leggere questo file. Controlla di aver scelto il file di backup giusto (finisce con .json).',
  formato: 'Questo file non sembra un backup di Registro incassi.',
  righe: 'Il file sembra danneggiato: per sicurezza non ho importato niente. Prova con un altro backup.',
};

function importMessage(added, existing) {
  const rec = added === 1 ? '1 riga ripristinata' : `${added} righe ripristinate`;
  if (existing === 0) return `Backup caricato: ${rec}.`;
  const pres = existing === 1 ? '1 era già presente' : `${existing} erano già presenti`;
  return `Backup caricato: ${rec}, ${pres}.`;
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
  if (parsed.entries.length === 0) {
    showToast('Il file è un backup valido ma non contiene righe.', null, 8000);
    return;
  }
  const { entries, added, existing } = mergeBackup(state.entries, parsed.entries);
  if (added === 0) {
    showToast('Niente da ripristinare: le righe del backup sono già tutte qui.', null, 8000);
    return;
  }
  try {
    await saveAll(entries);
  } catch {
    showBanner('ATTENZIONE: salvataggio non riuscito. Non chiudere l\'app e fai subito un export dei dati.');
    return;
  }
  state.entries = entries;
  onDataChanged?.();
  renderMonth(container, state, onDataChanged);
  showToast(importMessage(added, existing), null, 8000);
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

  const legend = ['B', 'S', 'R', 'C']
    .map((c) => `<span><span class="dot" style="background:var(--ch-${c})"></span>${c} ${CH_NAMES[c]} · ${formatCents(s.byChannel[c])}</span>`)
    .join('');

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
      ${dailyBarsSVG(s.perDay)}
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
      ${thresholdBarSVG(declared, THRESHOLD_CENTS)}
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
    runExport(`backup-incassi-${todayISO()}.json`, toJSON(state.entries), 'application/json');
  });

  container.querySelector('#imp-json').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // consente di riscegliere lo stesso file
    if (!file) return;
    await importBackupFile(file, container, state, onDataChanged);
  });
}

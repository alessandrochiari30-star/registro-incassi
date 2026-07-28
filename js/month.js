// Riepilogo mensile: la schermata che si guarda con calma.
// Ricostruita da zero a ogni apertura, sempre derivata dalle righe.

import { formatCents, todayISO } from './money.js';
import { monthStats, yearDeclared, prevMonthDelta } from './totals.js';
import { dailyBarsSVG, channelBarSVG, thresholdBarSVG } from './chart.js';
import { toCSV, toJSON } from './exporter.js';

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

async function shareFile(filename, content, mime) {
  const file = new File([content], filename, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch {
      return false; // annullato dall'utente: non è un errore
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  return true;
}

function markExported() {
  localStorage.setItem('ri-lastExport', String(Date.now()));
  document.getElementById('export-reminder').hidden = true;
}

export function renderMonth(container, state) {
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
      </div>
    </div>
  `;

  container.querySelector('#m-prev').addEventListener('click', () => {
    state.monthShown = shiftMonth(ym, -1);
    renderMonth(container, state);
  });
  container.querySelector('#m-next').addEventListener('click', () => {
    state.monthShown = shiftMonth(ym, 1);
    renderMonth(container, state);
  });

  container.querySelector('#exp-month').addEventListener('click', async () => {
    const rows = state.entries.filter((e) => e.date.startsWith(ym + '-'));
    if (await shareFile(`incassi-${ym}.csv`, toCSV(rows), 'text/csv')) markExported();
  });
  container.querySelector('#exp-all').addEventListener('click', async () => {
    if (await shareFile(`incassi-tutti-${todayISO()}.csv`, toCSV(state.entries), 'text/csv')) markExported();
  });
  container.querySelector('#exp-json').addEventListener('click', async () => {
    if (await shareFile(`backup-incassi-${todayISO()}.json`, toJSON(state.entries), 'application/json')) markExported();
  });
}

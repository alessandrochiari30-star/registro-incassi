// Grafici SVG generati come stringhe, senza librerie.
// Specifiche dataviz: marks sottili, gap di 2px fra i riempimenti,
// griglia recessiva, etichette dirette selettive (mai su ogni punto).

import { formatCents } from './money.js';
import { CHANNELS } from './channels.js';

const CH_COLORS = { B: 'var(--ch-B)', S: 'var(--ch-S)', R: 'var(--ch-R)', C: 'var(--ch-C)' };

// Quali giorni portano il numero sotto l'asse: uno ogni tre (1, 4, 7…)
// più l'ultimo del mese, se non cade già nella serie e dista almeno
// due giorni dall'etichetta precedente — a un giorno di distanza i due
// numeri si toccherebbero.
export function axisDays(n) {
  const days = [];
  for (let d = 1; d <= n; d += 3) days.push(d);
  const last = days[days.length - 1];
  if (n - last >= 2) days.push(n);
  return days;
}

// Barre giornaliere del mese: una serie sola (il totale del giorno),
// quindi un solo colore e nessuna legenda. Ogni giorno è una colonna
// toccabile a tutta altezza — anche i giorni a zero, che devono poter
// rispondere "nessun incasso" invece di restare muti. Il dettaglio non
// sta nel grafico: lo scrive fuori chi riceve il tocco.
export function dailyBarsSVG(perDay) {
  const W = 380, H = 152, PAD_B = 26, PAD_T = 12;
  const n = perDay.length;
  const max = Math.max(...perDay.map((d) => d.total), 1);
  const step = W / n;
  const bw = Math.max(2, step - 3);
  const chartH = H - PAD_B - PAD_T;
  const baseline = H - PAD_B;
  const labelled = new Set(axisDays(n));

  const cols = perDay.map((d, i) => {
    const day = i + 1;
    const x0 = i * step;
    const cx = x0 + step / 2;
    const bar = d.total === 0
      ? ''
      : (() => {
          const h = Math.max(2, (d.total / max) * chartH);
          return `<rect class="bar" x="${(x0 + (step - bw) / 2).toFixed(1)}" y="${(baseline - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2"/>`;
        })();
    const label = labelled.has(day)
      ? `<text class="lbl" x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9">${day}</text>`
      : '';
    // Il giorno scelto mostra sempre il suo numero, anche se l'asse
    // non lo etichetta: senza, su un 17 o un 23 non si capisce dove si
    // è atterrati.
    const labelSel = `<text class="lbl-sel" x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10">${day}</text>`;
    const titolo = d.total === 0 ? `${day}: nessun incasso` : `${day}: ${formatCents(d.total)}`;
    // Il giorno scelto si segna con un trattino sotto l'asse, non con
    // una fascia colorata: una fascia alta quanto il grafico si legge
    // come un'altra barra. Il rect "hit" copre tutta la colonna perché
    // il dito non deve centrare una barra alta due pixel.
    return `<g class="day-col" data-day="${day}"><title>${titolo}</title>` +
      `<rect class="tick" x="${(x0 + 1).toFixed(1)}" y="${(baseline + 2).toFixed(1)}" width="${Math.max(2, step - 2).toFixed(1)}" height="2" rx="1"/>` +
      `${bar}${label}${labelSel}` +
      `<rect class="hit" x="${x0.toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${H}"/></g>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Andamento giornaliero del mese: tocca un giorno per vedere l'incasso">
    <line x1="0" y1="${baseline}" x2="${W}" y2="${baseline}" stroke="var(--hairline)" stroke-width="1"/>
    ${cols}
  </svg>`;
}

// Ripartizione fra canali: barra 100% impilata orizzontale, gap 2px fra
// i segmenti, estremità arrotondate. L'identità la porta la legenda
// (lettera + nome + importo), mai il colore da solo.
export function channelBarSVG(byChannel) {
  const W = 380, H = 34, R = 4, GAP = 2;
  const total = CHANNELS.reduce((s, c) => s + byChannel[c], 0);
  if (total === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Nessun dato nel mese">
      <rect x="0" y="10" width="${W}" height="14" rx="${R}" fill="var(--surface-2)"/>
    </svg>`;
  }
  const present = CHANNELS.filter((c) => byChannel[c] > 0);
  const gaps = (present.length - 1) * GAP;
  let x = 0;
  let segs = '';
  present.forEach((c, i) => {
    const w = (byChannel[c] / total) * (W - gaps);
    segs += `<rect x="${x.toFixed(1)}" y="10" width="${Math.max(w, 3).toFixed(1)}" height="14" rx="${R}" fill="${CH_COLORS[c]}"/>`;
    x += w + GAP;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ripartizione per canale">${segs}</svg>`;
}

// Progressivo annuo verso la soglia, con una tacca intermedia: il
// minimale INPS arriva molto prima degli 85.000 e superarlo cambia i
// contributi, quindi deve vedersi sulla stessa barra.
export function thresholdBarSVG(declaredCents, thresholdCents, mark = null) {
  const W = 380, H = 34;
  const pct = Math.min(1, declaredCents / thresholdCents);
  const bar = `<rect x="0" y="8" width="${W}" height="10" rx="4" fill="var(--surface-2)"/>
    <rect x="0" y="8" width="${Math.max(3, pct * W).toFixed(1)}" height="10" rx="4" fill="var(--accent)"/>`;
  if (!mark) {
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Progressivo verso la soglia">${bar}</svg>`;
  }
  const mx = Math.min(W, (mark.valueCents / thresholdCents) * W);
  const anchor = mx > W * 0.75 ? 'end' : 'start';
  const tx = anchor === 'end' ? mx - 3 : mx + 3;
  const superato = declaredCents >= mark.valueCents;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Progressivo verso la soglia, con tacca ${mark.label}">
    ${bar}
    <rect x="${(mx - 1).toFixed(1)}" y="4" width="2" height="18" rx="1" fill="var(--ink-2)"/>
    <text x="${tx.toFixed(1)}" y="${H - 2}" text-anchor="${anchor}" font-size="10" fill="var(--ink-2)">${superato ? '✓ ' : ''}${mark.label}</text>
  </svg>`;
}

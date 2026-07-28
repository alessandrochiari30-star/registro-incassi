// Grafici SVG generati come stringhe, senza librerie.
// Specifiche dataviz: marks sottili, gap di 2px fra i riempimenti,
// griglia recessiva, etichette dirette selettive (mai su ogni punto).

const CH_COLORS = { B: 'var(--ch-B)', S: 'var(--ch-S)', R: 'var(--ch-R)', C: 'var(--ch-C)' };

// Barre giornaliere del mese: una serie sola (il totale del giorno),
// quindi un solo colore e nessuna legenda; etichetta diretta solo sul
// giorno migliore.
export function dailyBarsSVG(perDay) {
  const W = 380, H = 140, PAD_B = 18, PAD_T = 16;
  const n = perDay.length;
  const max = Math.max(...perDay.map((d) => d.total), 1);
  const bw = Math.max(2, Math.floor(W / n) - 2);
  const step = W / n;
  const chartH = H - PAD_B - PAD_T;

  let bars = '';
  let bestLabel = '';
  const maxIdx = perDay.findIndex((d) => d.total === max && max > 0);
  perDay.forEach((d, i) => {
    if (d.total === 0) return;
    const h = Math.max(2, (d.total / max) * chartH);
    const x = i * step + (step - bw) / 2;
    const y = H - PAD_B - h;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="2" fill="var(--accent)"/>`;
    if (i === maxIdx) {
      const euros = Math.round(d.total / 100);
      const anchor = i < n / 5 ? 'start' : i > (4 * n) / 5 ? 'end' : 'middle';
      const tx = anchor === 'start' ? x : anchor === 'end' ? x + bw : x + bw / 2;
      bestLabel = `<text x="${tx.toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="${anchor}" font-size="11" font-weight="600" fill="var(--ink-2)">${euros} €</text>`;
    }
  });

  const firstDay = 1, lastDay = n;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Andamento giornaliero del mese">
    <line x1="0" y1="${H - PAD_B}" x2="${W}" y2="${H - PAD_B}" stroke="var(--hairline)" stroke-width="1"/>
    ${bars}${bestLabel}
    <text x="0" y="${H - 4}" font-size="10" fill="var(--muted)">${firstDay}</text>
    <text x="${W}" y="${H - 4}" text-anchor="end" font-size="10" fill="var(--muted)">${lastDay}</text>
  </svg>`;
}

// Ripartizione fra canali: barra 100% impilata orizzontale, gap 2px fra
// i segmenti, estremità arrotondate. L'identità la porta la legenda
// (lettera + nome + importo), mai il colore da solo.
export function channelBarSVG(byChannel) {
  const W = 380, H = 34, R = 4, GAP = 2;
  const total = ['B', 'S', 'R', 'C'].reduce((s, c) => s + byChannel[c], 0);
  if (total === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Nessun dato nel mese">
      <rect x="0" y="10" width="${W}" height="14" rx="${R}" fill="var(--surface-2)"/>
    </svg>`;
  }
  const present = ['B', 'S', 'R', 'C'].filter((c) => byChannel[c] > 0);
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

// Progressivo annuo verso la soglia: barra singola con marcatore.
export function thresholdBarSVG(declaredCents, thresholdCents) {
  const W = 380, H = 26;
  const pct = Math.min(1, declaredCents / thresholdCents);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Progressivo verso la soglia">
    <rect x="0" y="8" width="${W}" height="10" rx="4" fill="var(--surface-2)"/>
    <rect x="0" y="8" width="${Math.max(3, pct * W).toFixed(1)}" height="10" rx="4" fill="var(--accent)"/>
  </svg>`;
}

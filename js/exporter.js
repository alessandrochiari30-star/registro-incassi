// Export dei dati. CSV per la lettura umana/fogli di calcolo (formato
// italiano: ';' e virgola decimale); JSON come backup completo,
// cancellate incluse.

function csvAmount(cents) {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
}

export function toCSV(entries) {
  const rows = entries
    .filter((e) => e.deletedAt == null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt))
    .map((e) => `${e.date};${e.channel};${csvAmount(e.amountCents)}`);
  return ['data;canale;importo', ...rows].join('\n') + '\n';
}

// Backup completo: incassi e uscite insieme, cancellate incluse. Le
// uscite stanno in un campo a parte, così i backup vecchi (che non le
// avevano) restano leggibili.
export function toJSON(entries, extras = []) {
  return JSON.stringify({ exportedAt: new Date().toISOString(), entries, extras }, null, 2);
}

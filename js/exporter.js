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

export function toJSON(entries) {
  return JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2);
}

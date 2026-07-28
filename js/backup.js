// Riconciliazione fra IndexedDB (primario) e mirror localStorage.
// Regola di sicurezza: il risultato non è mai più piccolo della copia
// più grande — mai sovrascrivere dati con un insieme ridotto.

export function reconcile(idbEntries, mirrorEntries) {
  const idb = idbEntries ?? [];
  const mirror = mirrorEntries ?? [];

  if (idb.length === 0 && mirror.length === 0) return { entries: [], source: 'idb', recovered: false };
  if (idb.length === 0) return { entries: mirror, source: 'mirror', recovered: true };
  if (mirror.length === 0) return { entries: idb, source: 'idb', recovered: false };

  const byId = new Map();
  for (const e of mirror) byId.set(e.id, e);
  for (const e of idb) byId.set(e.id, e); // in conflitto vince idb
  const entries = [...byId.values()];

  if (entries.length === idb.length) return { entries: idb, source: 'idb', recovered: false };
  return { entries, source: 'union', recovered: true };
}

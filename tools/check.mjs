// Controlli statici che i test unitari non possono fare: id del DOM
// cercati dal js contro quelli che esistono davvero, precache del
// service worker contro i moduli presenti, export mai usati fuori dal
// proprio file.
//
// Si lancia con `node tools/check.mjs` dalla radice del progetto.
// Non sostituisce `npm test`: stana le sviste di collegamento, che i
// test sulla logica pura non vedono (un id rinominato nell'HTML, un
// modulo nuovo dimenticato negli ASSETS del service worker).

import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(`${ROOT}/${p}`, 'utf8');

const html = await read('index.html');
const jsFiles = (await readdir(`${ROOT}/js`)).filter((f) => f.endsWith('.js'));
const sources = new Map();
for (const f of jsFiles) sources.set(f, await read(`js/${f}`));
const allJs = [...sources.values()].join('\n');

// ---------- id del DOM ----------
// Gli id esistono in due posti: nell'HTML della pagina e dentro i
// template che il js scrive (tutta la vista mese nasce lì).
const idsInHtml = new Set([
  ...[...html.matchAll(/\bid="([^"${]+)"/g)].map((m) => m[1]),
  ...[...allJs.matchAll(/\bid="([a-z0-9-]+)"/gi)].map((m) => m[1]),
]);
// gli id generati con un pezzo variabile: si tiene il prefisso
const prefissiGenerati = [...allJs.matchAll(/\bid="([a-z0-9-]+)\$\{/gi)].map((m) => m[1]);
const cercati = new Set([
  ...[...allJs.matchAll(/\$\('([a-z0-9-]+)'\)/gi)].map((m) => m[1]),
  ...[...allJs.matchAll(/getElementById\('([a-z0-9-]+)'\)/g)].map((m) => m[1]),
  ...[...allJs.matchAll(/querySelector\('#([a-z0-9-]+)'\)/g)].map((m) => m[1]),
]);
const idMancanti = [...cercati].filter((id) =>
  !idsInHtml.has(id) && !prefissiGenerati.some((p) => id.startsWith(p)));

// ---------- precache del service worker ----------
// Solo il blocco ASSETS: leggere tutte le stringhe di sw.js fa sballare
// il conto degli apici sugli apostrofi dei commenti in italiano.
const sw = await read('sw.js');
const blocco = /const ASSETS = \[([\s\S]*?)\];/.exec(sw)?.[1] ?? '';
const assets = [...blocco.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const jsNonPrecachati = jsFiles.filter((f) => !assets.includes(`js/${f}`));
const version = /VERSION = '([^']+)'/.exec(sw)?.[1];

// ---------- export usati solo dal proprio file ----------
// Non sono per forza morti: molti servono ai test. Serve a notare quando
// una funzione resta indietro dopo un accorpamento.
const soloInterni = [];
for (const [file, src] of sources) {
  const nomi = [
    ...[...src.matchAll(/export function (\w+)/g)].map((m) => m[1]),
    ...[...src.matchAll(/export const (\w+)/g)].map((m) => m[1]),
  ];
  for (const n of nomi) {
    const altrove = [...sources].filter(([f]) => f !== file)
      .some(([, s]) => new RegExp(`\\b${n}\\b`).test(s));
    if (!altrove) soloInterni.push(`${file}: ${n}`);
  }
}

const problemi = idMancanti.length + jsNonPrecachati.length;
console.log(JSON.stringify({
  swVersion: version,
  idCercatiMaMancanti: idMancanti,
  jsNonPrecachati,
  exportUsatiSoloNelProprioFile: soloInterni,
  moduli: jsFiles.length,
}, null, 2));
if (problemi > 0) {
  console.error(`\n${problemi} problema/i da sistemare.`);
  process.exit(1);
}

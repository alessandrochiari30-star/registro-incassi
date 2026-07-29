// Service worker: cache-first, tutto precachato. Dopo la prima visita
// l'app funziona integralmente offline. Per pubblicare una nuova
// versione basta incrementare VERSION.

const VERSION = 'ri-v11';
const ASSETS = [
  '.',
  'index.html',
  'style.css',
  'manifest.json',
  'js/app.js',
  'js/parser.js',
  'js/money.js',
  'js/totals.js',
  'js/backup.js',
  'js/exporter.js',
  'js/db.js',
  'js/ui.js',
  'js/month.js',
  'js/chart.js',
  'js/reset.js',
  'js/channels.js',
  'js/expenses.js',
  'js/reminder.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  if (ev.request.method !== 'GET') return;
  // La diagnostica deve dire la verità sul momento: mai dalla cache.
  if (new URL(ev.request.url).pathname.endsWith('/diag.html')) return;
  ev.respondWith(
    caches.match(ev.request, { ignoreSearch: true }).then(
      (hit) => hit ?? fetch(ev.request).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(ev.request, copy));
        return res;
      })
    )
  );
});
